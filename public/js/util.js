// Formatting + filter helpers shared by the map cards and the detail panel.

export const SIZE_LABEL = { small: '소형', medium: '중형', large: '대형' };
export const OUTLET_LABEL = { many: '콘센트 많음', some: '콘센트 보통', few: '콘센트 적음', none: '콘센트 없음' };
export const OUTLET_RANK = { none: 0, few: 1, some: 2, many: 3 };

export const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;

export function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  return m ? +m[1] * 60 + +m[2] : null;
}

// Is the cafe open at `date` (default now)? Handles past-midnight ranges.
export function isOpenNow(cafe, date = new Date()) {
  const o = toMinutes(cafe.open_time);
  let c = toMinutes(cafe.close_time);
  if (o == null || c == null) return false;
  const now = date.getHours() * 60 + date.getMinutes();
  if (c === 0) c = 24 * 60; // '24:00' means end of day
  if (c <= o) return now >= o || now < c % (24 * 60); // wraps past midnight
  return now >= o && now < c;
}

export function opensLate(cafe) {
  const o = toMinutes(cafe.open_time);
  let c = toMinutes(cafe.close_time);
  if (o == null || c == null) return false;
  if (c === 0) return true;
  if (c <= o) return true; // past midnight / 24h
  return c >= 22 * 60;
}

export function hoursText(cafe) {
  const c = cafe.close_time === '00:00' ? '24:00' : cafe.close_time;
  if (cafe.open_time === '00:00' && (c === '24:00')) return '24시간';
  return `${cafe.open_time} – ${c}`;
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

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
