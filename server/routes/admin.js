'use strict';

const express = require('express');
const db = require('../db');
const kakao = require('../kakao');
const ai = require('../ai');
const { decorate } = require('../cafeModel');
const { requireAdmin } = require('../auth');

const router = express.Router();

router.get('/capabilities', requireAdmin, (req, res) => {
  res.json({ kakao: kakao.HAS_KAKAO, ai: ai.HAS_AI });
});

// pending review queue
const pendingStmt = db.prepare(`SELECT * FROM cafes WHERE status = 'pending' ORDER BY created_at DESC`);
const setApproved = db.prepare(`UPDATE cafes SET status = 'approved', moderation_reason = NULL WHERE id = ?`);
const delCafe = db.prepare(`DELETE FROM cafes WHERE id = ?`);
const getCafe = db.prepare(`SELECT * FROM cafes WHERE id = ?`);

router.get('/pending', requireAdmin, (req, res) => {
  res.json(pendingStmt.all().map(decorate));
});
router.post('/cafes/:id/approve', requireAdmin, express.json(), (req, res) => {
  if (!getCafe.get(req.params.id)) return res.status(404).json({ error: 'not found' });
  setApproved.run(req.params.id);
  res.json(decorate(getCafe.get(req.params.id)));
});
router.post('/cafes/:id/reject', requireAdmin, express.json(), (req, res) => {
  if (!getCafe.get(req.params.id)) return res.status(404).json({ error: 'not found' });
  delCafe.run(req.params.id);
  res.json({ ok: true });
});

// Optional helper: search to find a place and grab its REAL kakao link.
router.get('/search', requireAdmin, async (req, res, next) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: '검색어(q)가 필요합니다.' });
  try {
    res.json({ results: await kakao.searchPlaces(q) });
  } catch (e) { next(e); }
});

// Core of the new flow: human pastes a Kakao place link; we return ONLY the
// fields that make sense to auto-fetch (location / photos / hours / price /
// AI review summary). Name and map links stay human-entered.
router.post('/enrich', requireAdmin, express.json(), async (req, res, next) => {
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

module.exports = router;
