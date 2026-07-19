'use strict';

// Per-cafe chat. Anyone may READ; to POST you must prove you're within 1km of
// the cafe (browser Geolocation coords, verified server-side). Client GPS can be
// spoofed — this is a lightweight social gate, not a security boundary.

const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
const RADIUS_KM = 1.0;

const getCafe = db.prepare('SELECT id, lat, lng, name FROM cafes WHERE id = ?');
const listMsgs = db.prepare(`
  SELECT m.id, m.body, m.created_at, u.name AS user_name
  FROM messages m JOIN users u ON u.id = m.user_id
  WHERE m.cafe_id = ? ORDER BY m.created_at ASC LIMIT 200
`);
const insertMsg = db.prepare('INSERT INTO messages (id, cafe_id, user_id, body) VALUES (?,?,?,?)');
const getMsg = db.prepare(`
  SELECT m.id, m.body, m.created_at, u.name AS user_name
  FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?
`);

function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// GET /api/cafes/:id/messages
router.get('/:id/messages', (req, res) => {
  if (!getCafe.get(req.params.id)) return res.status(404).json({ error: 'not found' });
  res.json({ messages: listMsgs.all(req.params.id), radiusKm: RADIUS_KM });
});

// POST /api/cafes/:id/messages  { body, lat, lng }
router.post('/:id/messages', requireAuth, express.json(), (req, res) => {
  const cafe = getCafe.get(req.params.id);
  if (!cafe) return res.status(404).json({ error: 'not found' });

  const body = (req.body?.body || '').trim();
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  if (!body) return res.status(400).json({ error: '메시지를 입력하세요.' });
  if (body.length > 500) return res.status(400).json({ error: '메시지가 너무 깁니다(500자).' });
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: '위치 인증이 필요합니다.' });
  }

  const dist = haversineKm(lat, lng, cafe.lat, cafe.lng);
  if (dist > RADIUS_KM) {
    return res.status(403).json({ error: `카페에서 ${dist.toFixed(1)}km 떨어져 있어요. ${RADIUS_KM}km 이내에서만 참여할 수 있어요.`, distanceKm: dist });
  }

  const id = crypto.randomUUID();
  insertMsg.run(id, cafe.id, req.user.id, body);
  res.status(201).json(getMsg.get(id));
});

module.exports = router;
