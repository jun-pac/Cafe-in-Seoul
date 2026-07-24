'use strict';

const db = require('./db');

// crawlers/monitors/link-preview fetchers hit the site without keeping cookies, so each
// hit looks like a new visitor. Flag them (and empty UAs) so real-people stats exclude them.
const BOT_UA = /bot|crawler|spider|crawling|slurp|mediapartners|bingpreview|facebookexternalhit|facebot|ia_archiver|embedly|quora link|pinterest|vkshare|whatsapp|telegram|discordbot|slackbot|twitterbot|linkedinbot|petalbot|yandex|baiduspider|duckduckbot|applebot|semrush|ahrefs|mj12bot|dotbot|curl|wget|python-requests|go-http|java\/|okhttp|axios|node-fetch|headless|phantomjs|puppeteer|playwright|lighthouse|gtmetrix|pingdom|uptime|statuscake|monitor|healthcheck|cloudflare|preview/i;

const isBotUA = (ua) => !ua || BOT_UA.test(ua);

// The site is Korean, so a "day" always means a KST calendar day (00:00–24:00 KST).
const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

// store ts as UTC explicitly (container TZ is UTC); analytics queries convert to KST (+9h)
const insertEvent = db.prepare(`INSERT INTO events
  (ts, day, session_id, user_id, type, target, label, ip, country, ua, is_bot, is_admin)
  VALUES (datetime('now'),@day,@session_id,@user_id,@type,@target,@label,@ip,@country,@ua,@is_bot,@is_admin)`);

// Record one event from an Express request. type is required; target/label optional.
function recordEvent(req, { type, target = null, label = null }) {
  try {
    const ua = req.get('user-agent') || '';
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
      is_admin: req.user?.is_admin ? 1 : 0,
    });
  } catch { /* analytics must never break a request */ }
}

// ---- analysis queries (real people only: is_bot=0, is_admin=0) ---------------
const one = (sql, ...a) => db.prepare(sql).get(...a);
const many = (sql, ...a) => db.prepare(sql).all(...a);
const HUMAN = `is_bot = 0 AND is_admin = 0`;

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

// THE definition of "visitors on a day" — distinct real people who loaded the page, on the KST
// calendar day. /api/stats (the counter on the map) and the admin panel both read this, so they
// cannot drift apart. Derived from events, so it is retroactively correct: the old daily_visits
// per-day rows were tallied live under a UTC day boundary and can't be recomputed.
const visitorsOn = (day) => one(`SELECT COUNT(DISTINCT session_id) AS n
  FROM events WHERE ${KDAY}=? AND type='pageview' AND ${HUMAN}`, day).n;

function analytics(day = kstToday()) {
  // Build each visitor's journey (ordered actions) so you can see what a real person did —
  // a real user has a varied trail (open cafe → filter → open view …), a bot has just pageviews.
  const humanEvents = many(`SELECT session_id, user_id, type, label, ip, country, ua, ${KTS} AS ts
    FROM events WHERE ${KDAY}=? AND ${HUMAN} ORDER BY id`, day);
  // ips seen on any EARLIER day → this session is a returning visitor, not a first-timer
  const seenBefore = new Set(many(`SELECT DISTINCT ip FROM events WHERE ${KDAY}<? AND ip IS NOT NULL AND ${HUMAN}`, day).map((r) => r.ip));

  const smap = new Map();
  for (const e of humanEvents) {
    let s = smap.get(e.session_id);
    if (!s) { s = { session_id: e.session_id, ip: e.ip, country: e.country, ua: e.ua, user_id: e.user_id, first_seen: e.ts, last_seen: e.ts, events: 0, pageviews: 0, actions: 0, depth: 0, trail: [] }; smap.set(e.session_id, s); }
    s.last_seen = e.ts; s.events++;
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
  // deepest first, then busiest — the interesting visitors float to the top instead of
  // whoever merely reloaded the page the most
  const sessions = all.slice().sort((a, b) => (b.depth - a.depth) || (b.events - a.events)).slice(0, 40);

  // A VISITOR is a session that loaded the page on this day — the same thing the public
  // "오늘 방문자" counter shows, so the two numbers can never disagree. A session can also be
  // active without a page load (a tab left open since yesterday still fires action beacons);
  // those are counted as `active`, not as visitors, and every per-visitor rate below is over
  // the visitor set so the buckets add up to it.
  const visitorSet = all.filter((s) => s.pageviews > 0);
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

  return {
    day,
    today: kstToday(),
    tz: 'KST (UTC+9)',
    sessions, // per-visitor with action trail (see above)
    // headline numbers for the selected KST day
    kpi: {
      visitors,                                 // sessions that loaded the page today (KST)
      active: all.length,                       // + sessions acting without a fresh page load
      pageviews: all.reduce((a, s) => a + s.pageviews, 0),
      actions: all.reduce((a, s) => a + s.actions, 0),
      engaged,                                  // visitors who opened at least one place
      engagedPct: pct(engaged),
      returning: visitorSet.filter((s) => s.returning).length,
      mobilePct: pct(visitorSet.filter((s) => s.mobile).length),
      botPageviews: one(`SELECT COUNT(*) AS n FROM events WHERE ${KDAY}=? AND type='pageview' AND is_bot=1`, day).n,
    },
    depth,
    trend,
    hours,
    countries: many(`SELECT country, COUNT(DISTINCT session_id) AS n FROM events WHERE ${KDAY}=? AND type='pageview' AND ${HUMAN} AND country IS NOT NULL GROUP BY country ORDER BY n DESC LIMIT 8`, day),
    // what people actually did on this day
    actionTypes: many(`SELECT type, COUNT(*) AS n, COUNT(DISTINCT session_id) AS people FROM events WHERE ${KDAY}=? AND ${HUMAN} AND type!='pageview' GROUP BY type ORDER BY n DESC`, day),
    topCafes: topDay('open_cafe'),
    topViews: topDay('open_view'),
    topSearches: topDay('search'),
    week: {
      from: one(`SELECT date(?, '-6 days') AS d`, day).d,
      to: day,
      visitors: one(`SELECT COUNT(DISTINCT session_id) AS n FROM events WHERE ${RANGE} AND type='pageview' AND ${HUMAN}`, day, day).n,
      pageviews: one(`SELECT COUNT(*) AS n FROM events WHERE ${RANGE} AND type='pageview' AND ${HUMAN}`, day, day).n,
      topCafes: topWeek('open_cafe'),
      topViews: topWeek('open_view'),
      topSearches: topWeek('search'),
    },
    // recent raw feed (all, incl. bots, so nothing is hidden)
    recent: many(`SELECT ${KTS} AS ts, type, label, target, ip, country, is_bot, is_admin, session_id, user_id
      FROM events WHERE ${KDAY}=? ORDER BY id DESC LIMIT 120`, day),
  };
}

module.exports = { recordEvent, analytics, isBotUA, BOT_UA, kstToday, visitorsOn };
