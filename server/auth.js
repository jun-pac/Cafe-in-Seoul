'use strict';

const crypto = require('crypto');
const express = require('express');
const passport = require('passport');
const { OAuth2Client } = require('google-auth-library');
const db = require('./db');

// Google Identity Services (GIS) token flow: needs only the public client ID.
// No client secret required (verification is done against Google's public keys).
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GIS_ENABLED = !!GOOGLE_CLIENT_ID;
const googleClient = GIS_ENABLED ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

// Optional allowlist of admin emails (comma-separated). If empty, every
// logged-in user is treated as admin (convenient for local/dev).
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

function isAdmin(user) {
  if (!user) return false;
  if (ADMIN_EMAILS.length === 0) return true;
  return ADMIN_EMAILS.includes((user.email || '').toLowerCase());
}

const findUser = db.prepare('SELECT * FROM users WHERE id = ?');
const findByProvider = db.prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?');
const insertUser = db.prepare(`
  INSERT INTO users (id, provider, provider_id, email, name, avatar_url)
  VALUES (@id, @provider, @provider_id, @email, @name, @avatar_url)
`);

function upsertUser({ provider, provider_id, email, name, avatar_url }) {
  const existing = findByProvider.get(provider, provider_id);
  if (existing) return existing;
  const id = crypto.randomUUID();
  insertUser.run({ id, provider, provider_id, email: email || null, name, avatar_url: avatar_url || null });
  return findUser.get(id);
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  try { done(null, findUser.get(id) || false); } catch (e) { done(e); }
});

const router = express.Router();

router.get('/me', (req, res) => {
  res.json({
    googleClientId: GIS_ENABLED ? GOOGLE_CLIENT_ID : null,
    devLoginEnabled: !GIS_ENABLED,
    user: req.user
      ? {
          id: req.user.id, name: req.user.name, email: req.user.email,
          avatar_url: req.user.avatar_url, isAdmin: isAdmin(req.user),
        }
      : null,
  });
});

// GIS: frontend gets an ID token (JWT) from Google and posts it here.
router.post('/google/verify', express.json(), async (req, res, next) => {
  if (!GIS_ENABLED) return res.status(403).json({ error: 'Google 로그인 미설정' });
  const { credential } = req.body || {};
  if (!credential) return res.status(400).json({ error: 'credential 누락' });
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    const user = upsertUser({
      provider: 'google',
      provider_id: p.sub,
      email: p.email,
      name: p.name || p.email || 'Google User',
      avatar_url: p.picture,
    });
    req.login(user, (err) => {
      if (err) return next(err);
      res.json({ user: { id: user.id, name: user.name, email: user.email, isAdmin: isAdmin(user) } });
    });
  } catch (e) {
    res.status(401).json({ error: 'Google 토큰 검증 실패' });
  }
});

// Dev login: only when Google isn't configured.
router.post('/dev-login', express.json(), (req, res, next) => {
  if (GIS_ENABLED) return res.status(403).json({ error: 'dev login disabled' });
  const name = (req.body?.name || '').trim() || `게스트-${Math.floor(1000 + Math.random() * 9000)}`;
  const user = upsertUser({
    provider: 'dev', provider_id: name.toLowerCase(),
    email: `${name}@dev.local`, name, avatar_url: null,
  });
  req.login(user, (err) => {
    if (err) return next(err);
    res.json({ user: { id: user.id, name: user.name, email: user.email, isAdmin: isAdmin(user) } });
  });
});

router.post('/logout', (req, res, next) => {
  req.logout((err) => (err ? next(err) : res.json({ ok: true })));
});

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  if (!isAdmin(req.user)) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  next();
}

module.exports = { router, requireAuth, requireAdmin, isAdmin, GIS_ENABLED };
