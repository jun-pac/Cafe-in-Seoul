'use strict';

// Admin-set site settings (key/value JSON). Currently: the global default score weights that
// everyone sees unless they set their own personal weights.
const db = require('./db');

const getStmt = db.prepare('SELECT value FROM app_settings WHERE key = ?');
const setStmt = db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

function get(key) { try { const r = getStmt.get(key); return r ? JSON.parse(r.value) : null; } catch { return null; } }
function set(key, value) { setStmt.run(key, JSON.stringify(value)); }

// score weights: only allow the known numeric keys, clamped, so a bad POST can't break scoring
const WEIGHT_KEYS = ['price', 'outlets', 'floors', 'late', 'size', 'view', 'quiet', 'coffee', 'restroom'];
function sanitizeWeights(w) {
  if (!w || typeof w !== 'object') return null;
  const out = {};
  for (const k of WEIGHT_KEYS) { const n = Number(w[k]); if (Number.isFinite(n) && n >= 0) out[k] = Math.min(100, Math.round(n)); }
  return Object.keys(out).length ? out : null;
}
const getScoreWeights = () => get('score_weights');
const setScoreWeights = (w) => { const s = sanitizeWeights(w); if (s) set('score_weights', s); return s; };

module.exports = { get, set, getScoreWeights, setScoreWeights, sanitizeWeights };
