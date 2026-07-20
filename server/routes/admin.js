'use strict';

const express = require('express');
const db = require('../db');
const kakao = require('../kakao');
const ai = require('../ai');
const { decorate } = require('../cafeModel');
const { requireAdmin, requireAuth } = require('../auth');

const router = express.Router();

router.get('/capabilities', requireAuth, (req, res) => {
  res.json({ kakao: kakao.HAS_KAKAO, ai: ai.HAS_AI });
});

// pending review queue
const pendingStmt = db.prepare(`SELECT * FROM cafes WHERE status = 'pending' ORDER BY created_at DESC`);
const setApproved = db.prepare(`UPDATE cafes SET status = 'approved', moderation_reason = NULL WHERE id = ?`);
// reject = SOFT delete. We never hard-delete a cafe: the row stays with
// status='rejected' (hidden from the map, recoverable) so nothing is ever lost.
const setRejected = db.prepare(`UPDATE cafes SET status = 'rejected' WHERE id = ?`);
const getCafe = db.prepare(`SELECT * FROM cafes WHERE id = ?`);

const userName = db.prepare('SELECT name FROM users WHERE id = ?');
router.get('/pending', requireAdmin, (req, res) => {
  res.json(pendingStmt.all().map((c) => ({ ...decorate(c), creator_name: c.created_by ? (userName.get(c.created_by)?.name || null) : null })));
});
router.post('/cafes/:id/approve', requireAdmin, express.json(), (req, res) => {
  if (!getCafe.get(req.params.id)) return res.status(404).json({ error: 'not found' });
  setApproved.run(req.params.id);
  res.json(decorate(getCafe.get(req.params.id)));
});
router.post('/cafes/:id/reject', requireAdmin, express.json(), (req, res) => {
  if (!getCafe.get(req.params.id)) return res.status(404).json({ error: 'not found' });
  setRejected.run(req.params.id); // soft delete — row preserved, just hidden
  res.json({ ok: true });
});

// Optional helper: search to find a place and grab its REAL kakao link.
router.get('/search', requireAuth, async (req, res, next) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: '검색어(q)가 필요합니다.' });
  try {
    res.json({ results: await kakao.searchPlaces(q) });
  } catch (e) { next(e); }
});

// Core of the new flow: human pastes a Kakao place link; we return ONLY the
// fields that make sense to auto-fetch (location / photos / hours / price /
// AI review summary). Name and map links stay human-entered.
router.post('/enrich', requireAuth, express.json(), async (req, res, next) => {
  const kakaoUrl = (req.body?.kakaoUrl || '').trim();
  const placeIdIn = (req.body?.placeId || '').toString().trim();
  try {
    const placeId = placeIdIn || await kakao.resolvePlaceId(kakaoUrl);
    if (!placeId) {
      return res.status(400).json({
        error: '카카오 링크에서 장소 ID를 찾지 못했어요. 카카오맵에서 카페 상세 → 공유 → 링크복사한 주소를 넣어주세요.',
      });
    }
    const detail = await kakao.fetchDetail(placeId);

    let aiOut = null, aiError = null;
    try { aiOut = await ai.summarize(detail); }
    catch (e) { aiError = e.message; }

    res.json({
      placeId,
      fetched: {
        lat: detail.lat,
        lng: detail.lng,
        address: detail.address,
        open_time: detail.open_time,
        close_time: detail.close_time,
        weekly: detail.weekly,
        hours_json: JSON.stringify(detail.weekly || []),
        iced_americano_price: detail.iced_americano_price,
        americano_menu_name: detail.americano_menu_name,
        photos: detail.photos,
        roadview: detail.roadview,
        rating: detail.rating,
        review_count: detail.review_count,
        strengths: detail.strengths,
        kakao_place_url: detail.kakao_url,
      },
      review_summary: aiOut?.summary || null,
      keywords: aiOut?.keywords || [],
      aiError,
    });
  } catch (e) { next(e); }
});

// AI draft for the 카공 총평 (admin edits it). Takes the form's current field values.
router.post('/draft-review', requireAuth, express.json(), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!ai.HAS_AI) return res.status(400).json({ error: 'AI가 설정되어 있지 않습니다 (OPENAI_API_KEY).' });
    const draft = await ai.draftStudyReview({
      name: b.name, floors: b.floors, size: b.size, outlets: b.outlets,
      has_view: b.has_view === true || b.has_view === 'true' || b.has_view === 1 || b.has_view === '1',
      view_note: b.view_note, open_time: b.open_time, close_time: b.close_time,
      iced_americano_price: b.iced_americano_price, review_summary: b.review_summary,
    });
    res.json({ draft: draft || '' });
  } catch (e) { next(e); }
});

// Admin insights: signups, content activity, and (de-inflated) visit counts.
router.get('/insights', requireAdmin, (req, res) => {
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const many = (sql, ...p) => db.prepare(sql).all(...p);
  const today = new Date().toISOString().slice(0, 10);
  res.json({
    users: {
      total: one('SELECT COUNT(*) AS c FROM users').c,
      recent: many(`SELECT provider, provider_id, name, is_admin, created_at FROM users ORDER BY created_at DESC LIMIT 25`),
    },
    content: {
      cafes: one("SELECT COUNT(*) AS c FROM cafes WHERE status != 'rejected'").c,
      viewspots: one('SELECT COUNT(*) AS c FROM viewspots').c,
      reviews: one('SELECT COUNT(*) AS c FROM reviews').c,
      votes: one('SELECT COUNT(*) AS c FROM votes').c,
      comments: one('SELECT COUNT(*) AS c FROM viewspot_comments').c,
    },
    visits: {
      today: one('SELECT n FROM daily_visits WHERE day = ?', today)?.n || 0,
      total: one('SELECT COALESCE(SUM(n), 0) AS t FROM daily_visits').t,
      days: many('SELECT day, n FROM daily_visits ORDER BY day DESC LIMIT 14'),
    },
    recentReviews: many(`SELECT r.body, r.created_at, u.name AS user_name, c.name AS cafe_name
      FROM reviews r JOIN users u ON u.id = r.user_id JOIN cafes c ON c.id = r.cafe_id
      ORDER BY r.created_at DESC LIMIT 15`),
  });
});

// Per-action analytics: unique visitors, what they clicked, per-session breakdown, raw feed.
const { analytics } = require('../analytics');
router.get('/analytics', requireAdmin, (req, res) => {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(req.query.day || '') ? req.query.day : undefined;
  res.json(analytics(day));
});

module.exports = router;
