// Formatting + filter helpers shared by the map cards and the detail panel.

export const SIZE_LABEL = { small: '소형', medium: '중형', large: '대형' };
export const OUTLET_LABEL = { many: '대부분 있음', some: '일부 있음', few: '드물게 있음', none: '없음' };
export const OUTLET_RANK = { none: 0, few: 1, some: 2, many: 3 };

// precise definitions surfaced as tooltips wherever these fields appear
export const DEFS = {
  size: '면적 — 소형: 테이블 5개 이하 / 중형: 6–15개 / 대형: 16개 이상',
  outlets: '콘센트 — 대부분 있음: 거의 모든 자리 / 일부 있음: 일부 자리 / 드물게 있음: 카운터 근처 등 소수 / 없음',
  floors: '층수 — 2층 이상이면 다층. 오래 머물러도 눈치가 덜 보임',
  view: '뷰 — 창밖 전망/경치가 특별히 좋은지',
  coffee: '커피맛 — 1(별로) ~ 5(훌륭)',
  quiet: '조용함 — 1(시끄러움) ~ 5(매우 조용)',
  restroom: '화장실 청결 — 1(별로) ~ 5(매우 깨끗)',
  price: '아이스 아메리카노 한 잔 가격',
};

export const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;

export function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  return m ? +m[1] * 60 + +m[2] : null;
}
export const DOW_LABEL = ['일', '월', '화', '수', '목', '금', '토'];

// weekly hours array [{dow, open, close, closed}] or null (falls back to single open/close)
export function getWeekly(cafe) {
  try { return cafe.hours_json ? JSON.parse(cafe.hours_json) : null; } catch { return null; }
}
function entryFor(cafe, dow) {
  const w = getWeekly(cafe);
  if (w) return w[dow] || { closed: true };
  return { open: cafe.open_time, close: cafe.close_time }; // single schedule → same every day
}
function is24(e) {
  if (!e || e.closed) return false;
  const o = toMinutes(e.open); let c = toMinutes(e.close);
  return o === 0 && c === 24 * 60; // 00:00 ~ 24:00
}
// Is entry open at `now` minutes? spillover=true tests the past-midnight tail (belongs to prev day).
function openInEntry(e, now, spillover) {
  if (!e || e.closed) return false;
  const o = toMinutes(e.open); let c = toMinutes(e.close);
  if (o == null || c == null) return false;
  if (c === 0) c = 24 * 60;
  if (c > o) return !spillover && now >= o && now < c;   // same-day range
  if (c === o) return !spillover;                         // exactly 24h wrap → open
  return spillover ? now < c : now >= o;                  // c<o: evening part today / early-morning next day
}

// Open now? Checks today's session + yesterday's past-midnight spillover. Handles 24h.
export function isOpenNow(cafe, date = new Date()) {
  const now = date.getHours() * 60 + date.getMinutes();
  const today = date.getDay();
  const yest = (today + 6) % 7;
  return openInEntry(entryFor(cafe, today), now, false) || openInEntry(entryFor(cafe, yest), now, true);
}

// Does today's schedule run late (closes 22:00+, past midnight, or 24h)?
export function opensLate(cafe, date = new Date()) {
  const e = entryFor(cafe, date.getDay());
  if (!e || e.closed) return false;
  if (is24(e)) return true;
  const o = toMinutes(e.open); let c = toMinutes(e.close);
  if (o == null || c == null) return false;
  if (c === 0) return true;
  if (c <= o) return true;      // past midnight
  return c >= 22 * 60;
}

function entryText(e) {
  if (!e || e.closed) return '휴무';
  if (is24(e)) return '24시간';
  const c = e.close === '00:00' ? '24:00' : e.close;
  return `${e.open} – ${c}`;
}
// today's hours, for the header line
export function hoursText(cafe, date = new Date()) {
  return entryText(entryFor(cafe, date.getDay()));
}
// full week, for the detail breakdown
export function weeklyHours(cafe, date = new Date()) {
  const w = getWeekly(cafe);
  const today = date.getDay();
  if (!w) return null; // single schedule → no per-day breakdown
  return w.map((e) => ({ label: DOW_LABEL[e.dow], text: entryText(e), isToday: e.dow === today }));
}

// filters: {
//   multiFloor, hasView, openNow, openLate,
//   sizes: Set, minOutlet: 'none'|'few'|'some'|'many',
//   maxPrice, minQuiet, minCoffee, minRestroom
// }
export function passesFilters(cafe, f) {
  if (f.multiFloor && !cafe.multi_floor) return false;
  if (f.hasView && !cafe.has_view) return false;
  if (f.openNow && !isOpenNow(cafe)) return false;
  if (f.openLate && !opensLate(cafe)) return false;
  if (f.sizes && f.sizes.size && !f.sizes.has(cafe.size)) return false;
  if (f.minOutlet && OUTLET_RANK[cafe.outlets] < OUTLET_RANK[f.minOutlet]) return false;
  if (f.maxPrice != null && cafe.iced_americano_price > f.maxPrice) return false;

  const a = cafe.votes?.averages || {};
  if (f.minQuiet > 0 && (a.quiet ?? 0) < f.minQuiet) return false;
  if (f.minCoffee > 0 && (a.coffee ?? 0) < f.minCoffee) return false;
  if (f.minRestroom > 0 && (a.restroom ?? 0) < f.minRestroom) return false;
  return true;
}

export function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Route Kakao/Naver CDN photos through our proxy (they block hotlinking).
// Local /uploads, blob:, data:, and other hosts are returned unchanged.
const PROXY_HOSTS = /(^|\.)(kakaocdn\.net|daumcdn\.net|pstatic\.net)$/i;
export function img(url) {
  if (!url) return url;
  try {
    const h = new URL(url, window.location.href).hostname;
    if (PROXY_HOSTS.test(h)) return '/api/img?u=' + encodeURIComponent(url);
  } catch { /* not absolute */ }
  return url;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
