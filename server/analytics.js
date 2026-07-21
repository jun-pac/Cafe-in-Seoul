'use strict';

const db = require('./db');

// crawlers/monitors/link-preview fetchers hit the site without keeping cookies, so each
// hit looks like a new visitor. Flag them (and empty UAs) so real-people stats exclude them.
const BOT_UA = /bot|crawler|spider|crawling|slurp|mediapartners|bingpreview|facebookexternalhit|facebot|ia_archiver|embedly|quora link|pinterest|vkshare|whatsapp|telegram|discordbot|slackbot|twitterbot|linkedinbot|petalbot|yandex|baiduspider|duckduckbot|applebot|semrush|ahrefs|mj12bot|dotbot|curl|wget|python-requests|go-http|java\/|okhttp|axios|node-fetch|headless|phantomjs|puppeteer|playwright|lighthouse|gtmetrix|pingdom|uptime|statuscake|monitor|healthcheck|cloudflare|preview/i;

const isBotUA = (ua) => !ua || BOT_UA.test(ua);

// store ts as UTC explicitly (container TZ is UTC); analytics queries convert to KST (+9h)
const insertEvent = db.prepare(`INSERT INTO events
  (ts, day, session_id, user_id, type, target, label, ip, country, ua, is_bot, is_admin)
  VALUES (datetime('now'),@day,@session_id,@user_id,@type,@target,@label,@ip,@country,@ua,@is_bot,@is_admin)`);

// Record one event from an Express request. type is required; target/label optional.
function recordEvent(req, { type, target = null, label = null }) {
  try {
    const ua = req.get('user-agent') || '';
    insertEvent.run({
      day: new Date().toISOString().slice(0, 10),
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

function analytics(day = new Date().toISOString().slice(0, 10)) {
  // Build each visitor's journey (ordered actions) so you can see what a real person did —
  // a real user has a varied trail (open cafe → filter → open view …), a bot has just pageviews.
  const humanEvents = many(`SELECT session_id, user_id, type, label, ip, country, ua, datetime(ts,'+9 hours') AS ts
    FROM events WHERE day=? AND ${HUMAN} ORDER BY id`, day);
  const smap = new Map();
  for (const e of humanEvents) {
    let s = smap.get(e.session_id);
    if (!s) { s = { session_id: e.session_id, ip: e.ip, country: e.country, ua: e.ua, user_id: e.user_id, first_seen: e.ts, last_seen: e.ts, events: 0, pageviews: 0, trail: [] }; smap.set(e.session_id, s); }
    s.last_seen = e.ts; s.events++;
    if (e.type === 'pageview') s.pageviews++;
    else if (s.trail.length < 40) s.trail.push({ type: e.type, label: e.label, ts: e.ts });
    if (e.user_id) s.user_id = e.user_id;
    if (e.ip) s.ip = e.ip;
  }
  const sessions = [...smap.values()].sort((a, b) => b.events - a.events).slice(0, 40);

  return {
    day,
    sessions, // per-visitor with action trail (see above)
    // headline numbers for TODAY
    today: {
      visitors: one(`SELECT COUNT(DISTINCT session_id) AS n FROM events WHERE day=? AND type='pageview' AND ${HUMAN}`, day).n,
      pageviews: one(`SELECT COUNT(*) AS n FROM events WHERE day=? AND type='pageview' AND ${HUMAN}`, day).n,
      botPageviews: one(`SELECT COUNT(*) AS n FROM events WHERE day=? AND type='pageview' AND is_bot=1`, day).n,
      countries: many(`SELECT country, COUNT(DISTINCT session_id) AS n FROM events WHERE day=? AND type='pageview' AND ${HUMAN} AND country IS NOT NULL GROUP BY country ORDER BY n DESC LIMIT 8`, day),
    },
    // what people actually did today
    actions: many(`SELECT type, COUNT(*) AS n FROM events WHERE day=? AND ${HUMAN} AND type!='pageview' GROUP BY type ORDER BY n DESC`, day),
    topCafes: many(`SELECT label, COUNT(*) AS n FROM events WHERE day=? AND type='open_cafe' AND ${HUMAN} GROUP BY label ORDER BY n DESC LIMIT 12`, day),
    topViews: many(`SELECT label, COUNT(*) AS n FROM events WHERE day=? AND type='open_view' AND ${HUMAN} GROUP BY label ORDER BY n DESC LIMIT 12`, day),
    topSearches: many(`SELECT label, COUNT(*) AS n FROM events WHERE day=? AND type='search' AND ${HUMAN} AND label IS NOT NULL GROUP BY label ORDER BY n DESC LIMIT 12`, day),
    // recent raw feed (all, incl. bots, so nothing is hidden)
    recent: many(`SELECT datetime(ts,'+9 hours') AS ts, type, label, target, ip, country, is_bot, is_admin, session_id, user_id
      FROM events WHERE day=? ORDER BY id DESC LIMIT 60`, day),
  };
}

module.exports = { recordEvent, analytics, isBotUA, BOT_UA };
