'use strict';

// Kakao data source for auto-initializing cafes.
//  - searchPlaces(): official Local REST API (keyword search)
//  - fetchDetail():  place "panel3" endpoint (hours / menu / reviews / photos)
// The panel3 endpoint is unofficial; failures are handled gracefully.

const KEY = process.env.KAKAO_API_KEY || '';
const HAS_KAKAO = !!KEY;

async function searchPlaces(query) {
  if (!HAS_KAKAO) throw new Error('KAKAO_API_KEY 미설정');
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&size=10`;
  const r = await fetch(url, { headers: { Authorization: `KakaoAK ${KEY}` } });
  if (!r.ok) throw new Error(`Kakao 검색 실패 (HTTP ${r.status})`);
  const { documents = [] } = await r.json();
  return documents.map((d) => ({
    id: d.id,
    name: d.place_name,
    category: d.category_name,
    isCafe: /카페|커피/.test(d.category_name || ''),
    address: d.road_address_name || d.address_name,
    phone: d.phone,
    lat: Number(d.y),
    lng: Number(d.x),
    place_url: d.place_url, // REAL place link (e.g. http://place.map.kakao.com/<id>)
  }));
}

function extractPlaceId(url) {
  if (!url) return null;
  let m = url.match(/place\.map\.kakao\.com\/(?:m\/)?(\d{5,})/);
  if (m) return m[1];
  m = url.match(/[?&](?:itemId|id)=(\d{5,})/); // ?itemId= or applink ?id=
  if (m) return m[1];
  m = url.match(/\/(\d{6,})(?:[/?#]|$)/);
  if (m) return m[1];
  return null;
}

// Resolve a pasted Kakao link (incl. short links like kko.kakao.com) to a place id.
async function resolvePlaceId(url) {
  const direct = extractPlaceId(url);
  if (direct) return direct;
  // short link → follow redirects and read the final URL
  if (/kko\.(kakao\.com|to)|\/o\//.test(url)) {
    try {
      const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
      return extractPlaceId(r.url);
    } catch { /* ignore */ }
  }
  return null;
}

const DOW = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };
function parseHours(openHours) {
  const days = openHours?.week_from_today?.week_periods?.flatMap((p) => p.days || []) || [];
  const byDow = {}; // dow -> {open,close} | {closed}
  let todayEntry = null;
  for (const d of days) {
    const dow = DOW[(d.day_of_the_week_desc || '')[0]];
    if (dow == null || byDow[dow]) continue; // week can list today twice; keep first
    const desc = d?.on_days?.start_end_time_desc || '';
    let entry;
    if (/24시간/.test(desc)) entry = { open: '00:00', close: '24:00' };
    else {
      const m = /(\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})/.exec(desc);
      entry = m ? { open: m[1].padStart(5, '0'), close: m[2].padStart(5, '0') } : { closed: true };
    }
    byDow[dow] = entry;
    if (d.is_highlight && !todayEntry) todayEntry = entry; // today's row
  }
  const weekly = [];
  for (let i = 0; i < 7; i++) weekly.push({ dow: i, ...(byDow[i] || { closed: true }) });
  // representative single schedule: today's, else first open day
  const rep = (todayEntry && !todayEntry.closed) ? todayEntry
    : weekly.find((e) => !e.closed) || { open: null, close: null };
  const hasHours = weekly.some((e) => !e.closed);
  return { open_time: rep.open || null, close_time: rep.close || null, weekly, hasHours };
}

function pickAmericano(items = []) {
  const cand = items.filter((i) => /아메리카노|americano/i.test(i.name || ''));
  if (!cand.length) return null;
  const iced = cand.find((i) => /아이스|ice|ICE|콜드/i.test(i.name || ''));
  const chosen = iced || cand[0];
  const price = Number(chosen.price);
  return { name: chosen.name, price: price > 0 ? price : null }; // Kakao uses -1 for "가격문의"
}

async function fetchDetail(id) {
  if (!HAS_KAKAO) throw new Error('KAKAO_API_KEY 미설정');
  const url = `https://place-api.map.kakao.com/places/panel3/${id}`;
  const r = await fetch(url, {
    headers: { Referer: `https://place.map.kakao.com/${id}`, 'User-Agent': 'Mozilla/5.0', pf: 'web' },
  });
  if (!r.ok) throw new Error(`Kakao 상세 실패 (HTTP ${r.status})`);
  const j = await r.json();

  const s = j.summary || {};
  const { open_time, close_time, weekly } = parseHours(j.open_hours);
  const americano = pickAmericano(j.menu?.menus?.items);

  const blogPhotos = (j.menu?.menus?.photos || []).map((p) => p.url).filter(Boolean);
  const roadview = s.road_view?.url || null;
  const photos = [...new Set([...blogPhotos, roadview].filter(Boolean))].slice(0, 12);

  const kReviews = (j.kakaomap_review?.reviews || [])
    .map((v) => ({ star: v.star_rating, text: (v.contents || '').replace(/\s+/g, ' ').trim() }))
    .filter((v) => v.text);
  const blogReviews = (j.blog_review?.reviews || [])
    .map((v) => ({ title: v.title, text: (v.contents || v.outline || '').replace(/\s+/g, ' ').trim() }))
    .filter((v) => v.text);

  const strengthNames = Object.fromEntries((j.kakaomap_review?.strength_description || []).map((x) => [x.id, x.name]));
  const strengths = (j.kakaomap_review?.score_set?.strength_counts || [])
    .map((x) => ({ name: strengthNames[x.id] || String(x.id), count: x.count }))
    .filter((x) => x.count);

  const name = s.name;
  return {
    id,
    name,
    category: s.category?.name4 || s.category?.name,
    address: s.address?.road || s.address?.disp,
    lat: s.point?.lat,
    lng: s.point?.lon,
    open_time,
    close_time,
    weekly,
    iced_americano_price: americano?.price || null,
    americano_menu_name: americano?.name || null,
    photos,
    roadview,
    rating: j.kakaomap_review?.score_set?.average_score || null,
    review_count: j.kakaomap_review?.score_set?.review_count || 0,
    strengths,
    kakao_url: `https://place.map.kakao.com/${id}`,
    naver_url: `https://map.naver.com/v5/search/${encodeURIComponent(name || '')}`,
    reviews: kReviews.slice(0, 15),
    blog_reviews: blogReviews.slice(0, 6),
  };
}

module.exports = { searchPlaces, fetchDetail, resolvePlaceId, extractPlaceId, HAS_KAKAO };
