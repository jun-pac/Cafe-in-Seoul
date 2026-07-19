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
const adminRouter = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1); // correct https cookies behind Cloudflare tunnel / proxy

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
    secure: (process.env.BASE_URL || '').startsWith('https'),
  },
}));
app.use(passport.initialize());
app.use(passport.session());

// static assets
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads'), { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// api
app.use('/api/auth', auth.router);
app.use('/api/cafes', cafesRouter);   // list / detail / create
app.use('/api/cafes', votesRouter);   // /:id/vote
app.use('/api/cafes', reviewsRouter); // /:id/reviews
app.use('/api/admin', adminRouter);   // kakao search + AI prefill

app.get('/api/health', (req, res) => res.json({ ok: true }));

// multer / generic error handler -> JSON
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error(err);
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  res.status(status).json({ error: err.message || '서버 오류' });
});

app.listen(PORT, () => {
  console.log(`\n☕  seoul-cafe running at ${process.env.BASE_URL || `http://localhost:${PORT}`}`);
  console.log(`   Google SSO: ${auth.GIS_ENABLED ? 'enabled (GIS token flow)' : 'disabled (using dev login)'}\n`);
});
