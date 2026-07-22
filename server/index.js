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

const app = express();
const PORT = process.env.PORT || 3000;

// don't let a single unhandled async error take down the whole server
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));

app.set('trust proxy', 1); // correct https cookies behind Cloudflare tunnel / proxy

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
const { recordEvent, isBotUA } = require('./analytics');
const bumpVisit = db.prepare(`INSERT INTO daily_visits (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1`);
app.use((req, res, next) => {
  try {
    const isPageLoad = req.method === 'GET' && (req.path === '/' || req.path === '/index.html');
    if (isPageLoad) {
      const ua = req.get('user-agent') || '';
      const isBot = isBotUA(ua);
      const today = new Date().toISOString().slice(0, 10);
      const reason = req.user?.is_admin ? 'admin'
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
const todayVisits = db.prepare('SELECT n FROM daily_visits WHERE day = ?');
const totalVisits = db.prepare('SELECT COALESCE(SUM(n), 0) AS t FROM daily_visits');
app.get('/api/stats', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  res.json({ date: today, today: todayVisits.get(today)?.n || 0, total: totalVisits.get().t });
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

app.listen(PORT, () => {
  console.log(`\n☕  seoul-cafe running at ${process.env.BASE_URL || `http://localhost:${PORT}`}`);
  console.log(`   Google SSO: ${auth.GIS_ENABLED ? 'enabled (GIS token flow)' : 'disabled (using dev login)'}\n`);
});
