'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const passport = require('passport');

const auth = require('./auth');
const cafesRouter = require('./routes/cafes');
const votesRouter = require('./routes/votes');
const reviewsRouter = require('./routes/reviews');
const chatRouter = require('./routes/chat');
const viewspotsRouter = require('./routes/viewspots');
const imgRouter = require('./routes/img');
const adminRouter = require('./routes/admin');
const seo = require('./seo');

const app = express();
const PORT = process.env.PORT || 3000;

// don't let a single unhandled async error take down the whole server
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));

app.set('trust proxy', 1); // correct https cookies behind Cloudflare tunnel / proxy

// latency instrumentation — times every request into an in-memory ring (see server/perf.js)
const perf = require('./perf');
app.use(perf.timing);

// Canonical host: 301 www → apex so search engines index ONE domain. Both
// cafe-in-seoul.com and www.cafe-in-seoul.com are currently indexed separately.
// Runs before the session so a bare redirect never mints a cookie. (https is
// handled by Cloudflare; local dev hits localhost and is unaffected.)
app.use((req, res, next) => {
  const host = req.headers.host || '';
  if (host.startsWith('www.')) return res.redirect(301, 'https://' + host.slice(4) + req.originalUrl);
  next();
});

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
    // 'auto' + trust proxy: Secure cookie over the HTTPS Cloudflare tunnel
    // (cloudflared sends X-Forwarded-Proto: https), plain cookie on direct
    // http://localhost:8001 — so login works both ways.
    secure: 'auto',
  },
}));
app.use(passport.initialize());
app.use(passport.session());

// api responses are dynamic — never cache them (fixes windows showing different counts)
app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

// daily visitor tally: count only real PAGE loads (not API/asset/script traffic),
// once per visitor session per day, and never count admins (so dev refreshes don't inflate it).
const db = require('./db');
// days are KST calendar days everywhere — with UTC days the public "오늘 방문자" counter
// reset at 09:00 KST, in the middle of the Korean morning.
const { recordEvent, isBotUA, kstToday, visitorsOn } = require('./analytics');
const bumpVisit = db.prepare(`INSERT INTO daily_visits (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1`);
app.use((req, res, next) => {
  try {
    const isPageLoad = req.method === 'GET' && (req.path === '/' || req.path === '/index.html');
    if (isPageLoad) {
      const ua = req.get('user-agent') || '';
      const isBot = isBotUA(ua);
      const today = kstToday();
      const reason = auth.isAdmin(req.user) ? 'admin'
        : isBot ? 'bot'
        : (req.session && req.session.visitDay === today) ? 'dupe'
        : 'counted';
      // record EVERY homepage load as a pageview event (session id distinguishes visitors;
      // is_bot/is_admin flags let analysis exclude noise). Console line stays for tailing.
      recordEvent(req, { type: 'pageview', label: reason });
      const ip = req.headers['cf-connecting-ip'] || req.ip || '?';
      const country = req.headers['cf-ipcountry'] || '?';
      console.log(`[PAGELOAD ${reason}] ip=${ip} ${country} ua=${JSON.stringify(ua).slice(0, 150)}`);
      if (reason === 'counted' && req.session) {
        req.session.visitDay = today;
        bumpVisit.run(today);
      }
    }
  } catch { /* ignore */ }
  next();
});

// client-side event beacon: the frontend posts {type,target,label} on meaningful actions
// (opening a cafe/view, filtering, searching, liking, ...) so we can see what people do.
const TRACK_TYPES = new Set(['open_cafe', 'open_view', 'filter', 'search', 'like', 'add_cafe', 'add_view', 'lang', 'install', 'locate']);
app.post('/api/track', express.json({ limit: '4kb' }), (req, res) => {
  const { type, target, label } = req.body || {};
  if (TRACK_TYPES.has(type)) recordEvent(req, { type, target, label });
  res.json({ ok: true });
});

// real-user performance beacon: the browser posts its own load timings (TTFB, LCP,
// time-to-map-render, marker count) once per session so we can see the lag people feel.
app.post('/api/perf', express.json({ limit: '2kb' }), (req, res) => {
  try { perf.recordClient(req.body || {}); } catch { /* ignore */ }
  res.json({ ok: true });
});
// "오늘" comes from the events table via visitorsOn() — the same query the admin panel uses, so
// the counter on the map and the admin number are the same number by construction. daily_visits
// stays as the all-time tally (it predates event logging); its per-day rows are legacy.
const totalVisits = db.prepare('SELECT COALESCE(SUM(n), 0) AS t FROM daily_visits');
app.get('/api/stats', (req, res) => {
  const today = kstToday();
  res.json({ date: today, today: visitorsOn(today), total: totalVisits.get().t });
});

// static assets
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads'), { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, '..', 'public'), {
  // revalidate code assets so a code update is never masked by a stale browser cache
  // (ETag → cheap 304 when unchanged); images/fonts still cache normally
  setHeaders: (res, filePath) => {
    // no-store so Cloudflare/browsers never serve a stale build (a Browser-Cache-TTL
    // override was masking code updates); images/fonts still cache via maxAge above
    if (/\.(js|css|html)$/.test(filePath)) res.setHeader('Cache-Control', 'no-store');
  },
}));

// crawlable server-rendered pages (/cafes, /views, /sitemap.xml, /robots.txt, /en/...).
// Mounted after static so real files always win; unknown paths fall through to these.
app.use('/', seo.router);

// api
app.use('/api/auth', auth.router);
app.use('/api/cafes', cafesRouter);   // list / detail / create
app.use('/api/cafes', votesRouter);   // /:id/vote
app.use('/api/cafes', reviewsRouter); // /:id/reviews
app.use('/api/cafes', chatRouter);    // /:id/messages
app.use('/api/viewspots', viewspotsRouter); // scenic view spots
app.use('/api/img', imgRouter);       // Kakao/Naver photo proxy
app.use('/api/admin', adminRouter);   // kakao search + AI prefill

app.get('/api/health', (req, res) => res.json({ ok: true }));

// multer / generic error handler -> JSON
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error(err);
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  res.status(status).json({ error: err.message || '서버 오류' });
});

require('./backupUploads').startUploadsBackup(); // mirror every photo file (boot + every 10 min)

// Repair English translations that were skipped while the OpenAI key had no credit —
// once at boot (30s in, after warm-up) and every 6h, so a credit lapse self-heals.
const { retranslateMissing } = require('./i18nContent');
setTimeout(() => { retranslateMissing(); }, 30_000);
setInterval(() => { retranslateMissing(); }, 6 * 60 * 60 * 1000).unref();

app.listen(PORT, () => {
  console.log(`\n☕  seoul-cafe running at ${process.env.BASE_URL || `http://localhost:${PORT}`}`);
  console.log(`   Google SSO: ${auth.GIS_ENABLED ? 'enabled (GIS token flow)' : 'disabled (using dev login)'}\n`);
});
