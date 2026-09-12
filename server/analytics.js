'use strict';

const db = require('./db');
// "admin" for exclusion means the SAME thing everywhere else: DB is_admin=1 OR an
// ADMIN_EMAILS-allowlisted email. Reading req.user.is_admin alone missed Google-login
// admins (column 0), so their own visits leaked into every "real people" KPI.
const { isAdmin } = require('./auth');

// crawlers/monitors/link-preview fetchers hit the site without keeping cookies, so each
// hit looks like a new visitor. Flag them (and empty UAs) so real-people stats exclude them.
// `\bnode\b` catches our own jsdom test harness, whose beacons carry the bare UA "node".
const BOT_UA = /bot|crawler|spider|crawling|slurp|mediapartners|bingpreview|facebookexternalhit|facebot|ia_archiver|embedly|quora link|pinterest|vkshare|whatsapp|telegram|discordbot|slackbot|twitterbot|linkedinbot|petalbot|yandex|baiduspider|duckduckbot|applebot|semrush|ahrefs|mj12bot|dotbot|curl|wget|python-requests|go-http|java\/|okhttp|axios|node-fetch|\bnode\b|headless|phantomjs|puppeteer|playwright|lighthouse|gtmetrix|pingdom|uptime|statuscake|monitor|healthcheck|cloudflare|preview/i;

const isBotUA = (ua) => !ua || BOT_UA.test(ua);

// ---- traffic-source classification ----------------------------------------
// Which AI / search engine a crawler UA belongs to (for "who is indexing us").
// Retroactive: runs over the ua we already store, so old rows classify too.
function classifyCrawler(ua) {
  ua = ua || '';
  if (/OAI-SearchBot|ChatGPT-User|GPTBot/i.test(ua)) return 'ChatGPT';
  if (/PerplexityBot|Perplexity-User/i.test(ua)) return 'Perplexity';
  if (/ClaudeBot|Claude-User|Claude-SearchBot|anthropic/i.test(ua)) return 'Claude';
  if (/Google-Extended/i.test(ua)) return 'Gemini';
  if (/Applebot-Extended|Bytespider|Amazonbot|CCBot|cohere|Diffbot|meta-externalagent|YouBot|Meltwater|Timpibot/i.test(ua)) return 'Other AI';
  if (/Googlebot|Google-InspectionTool|Storebot-Google/i.test(ua)) return 'Google';
  if (/bingbot|BingPreview|msnbot/i.test(ua)) return 'Bing';
  if (/YandexBot|Baiduspider|DuckDuckBot|NaverBot|Yeti|Daum/i.test(ua)) return 'Other search';
  if (/facebookexternalhit|kakaotalk-scrap|Twitterbot|Slackbot|Discordbot|TelegramBot|LinkedInBot|WhatsApp|Pinterest|redditbot/i.test(ua)) return 'Social preview';
  if (/AhrefsBot|SemrushBot|DotBot|MJ12bot|serpstat|trendiction|DomainArrivals|S33D|Spill|petalbot|dataforseo/i.test(ua)) return 'SEO tools';
  return 'Other bot';
}
const AI_CRAWLERS = new Set(['ChatGPT', 'Perplexity', 'Claude', 'Gemini', 'Other AI']);

// Where a human came from, from the utm_source param and/or the Referer host.
// Our own domain (a reload/internal click) counts as no source, so entry pages win.
const SELF_HOST = /(^|\.)cafe-in-seoul\.com$|localhost|127\.0\.0\.1/i;
function classifySource(referer, utm) {
  let host = '';
  try { host = referer ? new URL(referer).hostname : ''; } catch { /* malformed */ }
  const internal = host && SELF_HOST.test(host);
  const hay = `${(utm || '').toLowerCase()} ${internal ? '' : host.toLowerCase()}`;
  if (/chatgpt|openai|\boai\b/.test(hay)) return 'ChatGPT';
  if (/perplexity/.test(hay)) return 'Perplexity';
  if (/gemini|bard/.test(hay)) return 'Gemini';
  if (/claude|anthropic/.test(hay)) return 'Claude';
  if (/copilot|bingchat/.test(hay)) return 'Copilot';
  if (/google\./.test(host) && !internal) return 'Google';
  if (/naver\./.test(host)) return 'Naver';
  if (/bing\./.test(host)) return 'Bing';
  if (/daum\.|kakao/.test(host)) return 'Daum/Kakao';
  if (/instagram/.test(hay)) return 'Instagram';
  if (/facebook|fb\.com|fb\.me/.test(hay)) return 'Facebook';
  if (/t\.co|twitter|x\.com/.test(hay)) return 'X';
  if (/threads\.net/.test(hay)) return 'Threads';
  if (/youtube|youtu\.be/.test(hay)) return 'YouTube';
  if (/reddit/.test(hay)) return 'Reddit';
  if (/everytime/.test(hay)) return 'Everytime';
  if (utm) return utm.slice(0, 24);
  if (host && !internal) return host.replace(/^www\./, '').slice(0, 24);
  return 'Direct';   // no utm, no external referer (typed/bookmarked/app)
}
const AI_SOURCES = new Set(['ChatGPT', 'Perplexity', 'Gemini', 'Claude', 'Copilot']);

// The site is Korean, so a "day" always means a KST calendar day (00:00–24:00 KST).
const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

// store ts as UTC explicitly (container TZ is UTC); analytics queries convert to KST (+9h)
const insertEvent = db.prepare(`INSERT INTO events
  (ts, day, session_id, user_id, type, target, label, ip, country, ua, is_bot, is_admin, referer, source)
  VALUES (datetime('now'),@day,@session_id,@user_id,@type,@target,@label,@ip,@country,@ua,@is_bot,@is_admin,@referer,@source)`);

// Record one event from an Express request. type is required; target/label optional.
function recordEvent(req, { type, target = null, label = null }) {
  try {
    const ua = req.get('user-agent') || '';
    const referer = req.get('referer') || null;
    // OpenAI/ChatGPT tags outbound links with utm_source=chatgpt.com; other engines set Referer.
    const utm = (req.query && (req.query.utm_source || req.query.ref)) || null;
    insertEvent.run({
      // convenience column only — analytics derives the day from ts (see KDAY below), which
      // keeps rows written before this was KST bucketed correctly too.
      day: kstToday(),
      session_id: req.sessionID || null,
      user_id: req.user?.id || null,
      type,
      target: target ? String(target).slice(0, 200) : null,
      label: label ? String(label).slice(0, 120) : null,
      ip: req.headers['cf-connecting-ip'] || req.ip || null,
      country: req.headers['cf-ipcountry'] || null,
      ua: ua.slice(0, 200),
      is_bot: isBotUA(ua) ? 1 : 0,
      is_admin: isAdmin(req.user) ? 1 : 0, // email-allowlist admins included, not just DB flag
      referer: referer ? String(referer).slice(0, 300) : null,
      source: classifySource(referer, utm),
    });
  } catch { /* analytics must never break a request */ }
}

// ---- analysis queries (real people only) -------------------------------------
const one = (sql, ...a) => db.prepare(sql).get(...a);
const many = (sql, ...a) => db.prepare(sql).all(...a);
// Real traffic only ever reaches the site through Cloudflare, which always sets a public
// cf-connecting-ip. So a private / loopback IP means local or test traffic (our jsdom harness
// hitting localhost:8001), never a real visitor. Excluding it here fixes the stats for rows
// already in the table too — no is_bot backfill, nothing rewritten.
const PUBLIC_IP = `ip IS NOT NULL
  AND ip NOT LIKE '127.%' AND ip NOT LIKE '::1' AND ip NOT LIKE '10.%' AND ip NOT LIKE '192.168.%'
  AND ip NOT GLOB '172.1[6-9].*' AND ip NOT GLOB '172.2[0-9].*' AND ip NOT GLOB '172.3[01].*'
  AND ip NOT LIKE '::ffff:127.%' AND ip NOT LIKE '::ffff:10.%' AND ip NOT LIKE '::ffff:192.168.%'
  AND ip NOT GLOB '::ffff:172.1[6-9].*' AND ip NOT GLOB '::ffff:172.2[0-9].*' AND ip NOT GLOB '::ffff:172.3[01].*'`;
const HUMAN = `is_bot = 0 AND is_admin = 0 AND ${PUBLIC_IP}`;

// EVERY number and timestamp below is Korea time (UTC+9), including the day buckets.
// `ts` is stored as UTC and the legacy `day` column was bucketed by the UTC *date*, so its
// "days" actually ran 09:00→09:00 KST — that is why one day's feed used to look like two
// different days spliced together. We derive the day from ts instead, which fixes the
// bucketing for rows already in the table too (no migration, nothing rewritten).
const KDAY = `date(ts, '+9 hours')`;   // the KST calendar day an event belongs to
const KTS = `datetime(ts, '+9 hours')`; // the event time, in KST

// How deep into the product a session got. A visitor's depth is their deepest action, so
// the four buckets are mutually exclusive and add up to the day's visitor count.
const DEPTH = { filter: 1, search: 1, locate: 1, lang: 1, open_cafe: 2, open_view: 2, like: 3, add_cafe: 3, add_view: 3, install: 3 };
const DEPTH_KEYS = ['bounce', 'browse', 'open', 'act'];
const isMobileUA = (ua) => /Mobi|Android|iPhone|iPad|iPod/i.test(ua || '');

// THE definition of "visitors on a day" — distinct real people who viewed the map home OR a
// collection/SEO hub page, on the KST calendar day (total reach). /api/stats (the map counter)
// and the admin panel both read this, so they cannot drift apart. How many of these actually
// reached the interactive map vs. only read a list is the collection→map flow breakdown.
// Derived from events, so retroactively correct within the events history.
const visitorsOn = (day) => one(`SELECT COUNT(DISTINCT session_id) AS n
  FROM events WHERE ${KDAY}=? AND type IN ('pageview','collection') AND ${HUMAN}`, day).n;

function analytics(day = kstToday()) {
  // Build each visitor's journey (ordered actions) so you can see what a real person did —
  // a real user has a varied trail (open cafe → filter → open view …), a bot has just pageviews.
  const humanEvents = many(`SELECT session_id, user_id, type, label, ip, country, ua, source, ${KTS} AS ts
    FROM events WHERE ${KDAY}=? AND ${HUMAN} ORDER BY id`, day);
  // ips seen on any EARLIER day → this session is a returning visitor, not a first-timer
  const seenBefore = new Set(many(`SELECT DISTINCT ip FROM events WHERE ${KDAY}<? AND ip IS NOT NULL AND ${HUMAN}`, day).map((r) => r.ip));

  const smap = new Map();
  for (const e of humanEvents) {
    let s = smap.get(e.session_id);
    if (!s) { s = { session_id: e.session_id, ip: e.ip, country: e.country, ua: e.ua, user_id: e.user_id, first_seen: e.ts, last_seen: e.ts, events: 0, pageviews: 0, actions: 0, depth: 0, trail: [], source: 'Direct', sawCollection: false }; smap.set(e.session_id, s); }
    s.last_seen = e.ts; s.events++;
    // the session's source is the first non-Direct one seen — the real entry point,
    // not a later same-site reload (which classifies as Direct)
    if (s.source === 'Direct' && e.source && e.source !== 'Direct') s.source = e.source;
    if (e.type === 'collection') s.sawCollection = true;
    if (e.type === 'pageview') s.pageviews++;
    else {
      s.actions++;
      s.depth = Math.max(s.depth, DEPTH[e.type] || 0);
      if (s.trail.length < 40) s.trail.push({ type: e.type, label: e.label, ts: e.ts });
    }
    if (e.user_id) s.user_id = e.user_id;
    if (e.ip) s.ip = e.ip;
  }
  for (const s of smap.values()) {
    s.mobile = isMobileUA(s.ua) ? 1 : 0;
    s.returning = seenBefore.has(s.ip) ? 1 : 0;
    s.minutes = Math.round((Date.parse(s.last_seen + 'Z') - Date.parse(s.first_seen + 'Z')) / 60000) || 0;
  }
  const all = [...smap.values()];
  // most recent activity first — reads chronologically like the raw log, newest at the top.
  // (depth still shows per-row via the action trail; it just isn't the sort key.)
  // most recent activity first; cap high enough to show every visitor on a normal day
  const sessions = all.slice().sort((a, b) => (a.last_seen < b.last_seen ? 1 : a.last_seen > b.last_seen ? -1 : 0)).slice(0, 200);

  // A VISITOR = a session that viewed the map home OR a collection/SEO page this day (total
  // reach) — the same thing the public "오늘 방문자" counter shows, so the two never disagree.
  // How many reached the interactive map vs only read a list is the collection→map flow below.
  // A session can also be active without any page view (a tab left open still fires action
  // beacons); those count as `active`, not visitors.
  const visitorSet = all.filter((s) => s.pageviews > 0 || s.sawCollection);
  const visitors = visitorSet.length;
  const depth = DEPTH_KEYS.map((key, i) => ({ key, n: visitorSet.filter((s) => s.depth === i).length }));
  const engaged = visitorSet.filter((s) => s.depth >= 2).length;
  const pct = (n) => (visitors ? Math.round((n / visitors) * 100) : 0);

  // Last 14 KST days, oldest → newest, so the UI can draw a trend and let you pick a day.
  // GROUP BY/ORDER BY repeat the expression on purpose: `day` is also a real column here, and
  // SQLite would resolve the bare name to that (UTC) column instead of this alias.
  const trend = many(`SELECT ${KDAY} AS day,
      COUNT(DISTINCT CASE WHEN type='pageview' THEN session_id END) AS visitors,
      SUM(CASE WHEN type='pageview' THEN 1 ELSE 0 END) AS pageviews,
      SUM(CASE WHEN type='pageview' THEN 0 ELSE 1 END) AS actions
    FROM events WHERE ${HUMAN} GROUP BY ${KDAY} ORDER BY ${KDAY} DESC LIMIT 14`).reverse();

  // when do people actually show up (KST hour of day)
  const hourRows = many(`SELECT CAST(strftime('%H', ts, '+9 hours') AS INTEGER) AS h,
      COUNT(DISTINCT session_id) AS visitors, COUNT(*) AS events
    FROM events WHERE ${KDAY}=? AND ${HUMAN} GROUP BY h`, day);
  const hours = Array.from({ length: 24 }, (_, h) => hourRows.find((r) => r.h === h) || { h, visitors: 0, events: 0 });

  // one day is too thin to rank places by, so the top lists also come in a 7-day flavour
  const RANGE = `${KDAY} BETWEEN date(?, '-6 days') AND ?`;
  const topSql = (where) => `SELECT label, COUNT(*) AS n, COUNT(DISTINCT session_id) AS people
    FROM events WHERE ${where} AND type=? AND ${HUMAN} AND label IS NOT NULL GROUP BY label ORDER BY n DESC LIMIT 12`;
  const topDay = (type) => many(topSql(`${KDAY}=?`), day, type);
  const topWeek = (type) => many(topSql(RANGE), day, day, type);

  // ---- exploration flow (collection → map) for THIS day, real people --------
  // Do people who land on a collection/hub page also reach the interactive map, or do they
  // read the list and leave? (Only meaningful since collection visits now persist a session.)
  const collDay = `SELECT DISTINCT session_id FROM events WHERE type='collection' AND ${HUMAN} AND ${KDAY}=? AND session_id IS NOT NULL`;
  const flowN = (extra, extraParams = []) => one(`SELECT COUNT(*) AS n FROM (${collDay}) c ${extra}`, day, ...extraParams).n;
  const flow = {
    day,
    visits: one(`SELECT COUNT(*) AS n FROM events WHERE type='collection' AND ${HUMAN} AND ${KDAY}=?`, day).n, // total collection page views that day
    visitors: flowN(''),                                                                              // distinct people who saw a collection page
    toMap: flowN(`WHERE EXISTS (SELECT 1 FROM events e WHERE e.session_id=c.session_id AND e.type='pageview' AND date(e.ts,'+9 hours')=?)`, [day]),          // ...who also loaded the map that day
    toAction: flowN(`WHERE EXISTS (SELECT 1 FROM events e WHERE e.session_id=c.session_id AND e.type IN('open_cafe','open_view','filter','search','like') AND date(e.ts,'+9 hours')=?)`, [day]), // ...who opened/searched
  };
  flow.collOnly = Math.max(0, flow.visitors - flow.toMap);   // saw a list, never reached the map

  // where the humans came from (this day), by distinct visitor. AI answer engines flagged.
  const srcMap = new Map();
  for (const s of visitorSet) srcMap.set(s.source, (srcMap.get(s.source) || 0) + 1);
  const sources = [...srcMap.entries()].map(([name, n]) => ({ name, n, ai: AI_SOURCES.has(name) })).sort((a, b) => b.n - a.n);
  const aiReferrals = visitorSet.filter((s) => AI_SOURCES.has(s.source)).length;

  // who CRAWLED us (bots), classified from UA — retroactive, answers "누가 우리를 색인하나".
  // This is separate from human traffic: an AI crawl is not a visit.
  const crawlerRows = many(`SELECT ua, COUNT(*) AS n, COUNT(DISTINCT session_id) AS s
    FROM events WHERE ${KDAY}=? AND type='pageview' AND is_bot=1 GROUP BY ua`, day);
  const crawlMap = new Map();
  for (const r of crawlerRows) {
    const name = classifyCrawler(r.ua);
    const c = crawlMap.get(name) || { name, n: 0, ai: AI_CRAWLERS.has(name) };
    c.n += r.n; crawlMap.set(name, c);
  }
  const crawlers = [...crawlMap.values()].sort((a, b) => b.n - a.n);
  const aiCrawls = crawlers.filter((c) => c.ai).reduce((a, c) => a + c.n, 0);

  return {
    day,
    today: kstToday(),
    tz: 'KST (UTC+9)',
    sessions, // per-visitor with action trail (see above)
    // headline numbers for the selected KST day
    kpi: {
      visitors,                                 // total reach: sessions that saw the map home OR a collection page
      mapVisitors: visitorSet.filter((s) => s.pageviews > 0).length, // distinct people who loaded the map home
      active: all.length,                       // + sessions acting without a fresh page load
      pageviews: all.reduce((a, s) => a + s.pageviews, 0), // map-home loads (a count, reloads included)
      actions: all.reduce((a, s) => a + s.actions, 0),
      engaged,                                  // visitors who opened at least one place
      engagedPct: pct(engaged),
      returning: visitorSet.filter((s) => s.returning).length,
      mobilePct: pct(visitorSet.filter((s) => s.mobile).length),
      botPageviews: one(`SELECT COUNT(*) AS n FROM events WHERE ${KDAY}=? AND type='pageview' AND is_bot=1`, day).n,
      aiReferrals,   // human visitors who arrived from an AI answer engine
      aiCrawls,      // times an AI crawler fetched a page (bot, not a visit)
    },
    depth,
    trend,
    hours,
    sources,        // human traffic sources (Direct/Google/Naver/ChatGPT/…)
    crawlers,       // bot page fetches by crawler family (Google/ChatGPT/Perplexity/…)
    countries: many(`SELECT country, COUNT(DISTINCT session_id) AS n FROM events WHERE ${KDAY}=? AND type='pageview' AND ${HUMAN} AND country IS NOT NULL GROUP BY country ORDER BY n DESC LIMIT 8`, day),
    // what people actually did on this day
    actionTypes: many(`SELECT type, COUNT(*) AS n, COUNT(DISTINCT session_id) AS people FROM events WHERE ${KDAY}=? AND ${HUMAN} AND type!='pageview' GROUP BY type ORDER BY n DESC`, day),
    topCafes: topDay('open_cafe'),
    topViews: topDay('open_view'),
    topSearches: topDay('search'),
    topCollections: topDay('collection'),
    flow,   // collection → map exploration funnel (7-day)
    week: {
      from: one(`SELECT date(?, '-6 days') AS d`, day).d,
      to: day,
      visitors: one(`SELECT COUNT(DISTINCT session_id) AS n FROM events WHERE ${RANGE} AND type='pageview' AND ${HUMAN}`, day, day).n,
      pageviews: one(`SELECT COUNT(*) AS n FROM events WHERE ${RANGE} AND type='pageview' AND ${HUMAN}`, day, day).n,
      topCafes: topWeek('open_cafe'),
      topViews: topWeek('open_view'),
      topSearches: topWeek('search'),
      // SEO collection/combo pages people (not bots) landed on — the header "카페 모음" hub too
      topCollections: topWeek('collection'),
    },
    // recent raw feed (all, incl. bots, so nothing is hidden)
    recent: many(`SELECT ${KTS} AS ts, type, label, target, ip, country, is_bot, is_admin, session_id, user_id
      FROM events WHERE ${KDAY}=? ORDER BY id DESC LIMIT 120`, day),
  };
}

module.exports = { recordEvent, analytics, isBotUA, BOT_UA, kstToday, visitorsOn, classifySource, classifyCrawler };
