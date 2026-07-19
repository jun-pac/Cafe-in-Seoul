'use strict';

const express = require('express');
const kakao = require('../kakao');
const ai = require('../ai');
const { requireAdmin } = require('../auth');

const router = express.Router();

// GET /api/admin/capabilities — what data sources are configured
router.get('/capabilities', requireAdmin, (req, res) => {
  res.json({ kakao: kakao.HAS_KAKAO, ai: ai.HAS_AI });
});

// GET /api/admin/search?q=성수 카페 — candidate places from Kakao
router.get('/search', requireAdmin, async (req, res, next) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: '검색어(q)가 필요합니다.' });
  try {
    res.json({ results: await kakao.searchPlaces(q) });
  } catch (e) { next(e); }
});

// GET /api/admin/prefill/:id — detail + AI enrichment merged into a form prefill
router.get('/prefill/:id', requireAdmin, async (req, res, next) => {
  try {
    const detail = await kakao.fetchDetail(req.params.id);

    let aiOut = null, aiError = null;
    try {
      aiOut = await ai.enrich(detail);
    } catch (e) {
      aiError = e.message; // AI is best-effort; still return Kakao data
    }

    const floors = aiOut?.floors_guess || (aiOut?.multi_floor ? 2 : 1);
    const suggested = {
      name: detail.name,
      address: detail.address,
      lat: detail.lat,
      lng: detail.lng,
      open_time: detail.open_time || '09:00',
      close_time: detail.close_time || '22:00',
      iced_americano_price: detail.iced_americano_price || '',
      naver_url: detail.naver_url,
      kakao_url: detail.kakao_url,
      floors,
      size: aiOut?.size || 'medium',
      outlets: aiOut?.outlets || 'some',
      has_view: aiOut?.has_view ?? false,
      view_note: aiOut?.view_note || (detail.roadview ? '' : ''),
      photo_url: detail.photos[0] || detail.roadview || '',
    };

    res.json({
      suggested,
      kakao: {
        weekly: detail.weekly,
        photos: detail.photos,
        roadview: detail.roadview,
        rating: detail.rating,
        review_count: detail.review_count,
        strengths: detail.strengths,
        americano_menu_name: detail.americano_menu_name,
        category: detail.category,
      },
      ai: aiOut,
      aiError,
    });
  } catch (e) { next(e); }
});

module.exports = router;
