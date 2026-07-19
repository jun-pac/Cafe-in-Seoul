'use strict';

// Decides whether a submitted cafe is published immediately or held for admin
// review. Admin submissions are always approved. For others:
//   1) existence check via Kakao (place resolves + coords roughly match)
//   2) "특별함" judged by AI (falls back to rules if AI unavailable)
// Returns { status: 'approved'|'pending', reason }.

const kakao = require('./kakao');
const ai = require('./ai');
const { opensLate, toMinutes } = require('./score');

function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function reallyLate(cafe) {
  const o = toMinutes(cafe.open_time);
  const c = toMinutes(cafe.close_time);
  if (o == null || c == null) return false;
  if (c === 0 || c <= o) return true;      // past midnight / 24h
  return c >= 23 * 60;                       // closes 23:00+
}
function bigMultiFloor(cafe) {
  return (cafe.size === 'large' && Number(cafe.floors) >= 2) || Number(cafe.floors) >= 3;
}
function ruleSpecial(cafe) {
  return reallyLate(cafe) || bigMultiFloor(cafe) || !!cafe.has_view;
}

async function checkExistence(cafe) {
  if (!kakao.HAS_KAKAO) return { ok: true }; // can't check → don't block on this axis
  try {
    const placeId = cafe.kakao_place_id || (await kakao.resolvePlaceId(cafe.kakao_url));
    if (!placeId) return { ok: false, reason: '카카오 장소를 확인할 수 없어요(링크 확인 필요).' };
    const d = await kakao.fetchDetail(placeId);
    if (d?.lat != null && cafe.lat != null) {
      const km = haversineKm(+cafe.lat, +cafe.lng, d.lat, d.lng);
      if (km > 1.0) return { ok: false, reason: `제출 위치가 카카오 장소와 ${km.toFixed(1)}km 떨어져 있어요(정보 상충).` };
    }
    return { ok: true, placeId };
  } catch (e) {
    return { ok: false, reason: '카카오 장소 정보 확인 실패.' };
  }
}

async function moderate(cafe, { isAdmin }) {
  if (isAdmin) return { status: 'approved', reason: null };

  const exist = await checkExistence(cafe);
  if (!exist.ok) return { status: 'pending', reason: exist.reason };

  // AI judgment (best-effort); fall back to rules
  let aiOut = null;
  try { aiOut = await ai.moderate(cafe); } catch { /* ignore */ }

  if (aiOut?.decision) {
    return {
      status: aiOut.decision === 'approve' ? 'approved' : 'pending',
      reason: aiOut.reason || null,
    };
  }
  // rule fallback
  return ruleSpecial(cafe)
    ? { status: 'approved', reason: null }
    : { status: 'pending', reason: '뚜렷한 특별함(심야영업/대형복층/뷰)이 확인되지 않아 관리자 확인이 필요해요.' };
}

module.exports = { moderate, ruleSpecial, reallyLate };
