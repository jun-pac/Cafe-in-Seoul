// Formatting + filter helpers shared by the map cards and the detail panel.

import { t } from './i18n.js';

export const OUTLET_RANK = { none: 0, few: 1, some: 2, many: 3 };
export const sizeLabel = (s) => t(`size.${s}`);
export const outletLabel = (o) => t(`outlet.${o}`);
export const def = (k) => t(`def.${k}`); // field definition tooltip (localized)

export const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;

export function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  return m ? +m[1] * 60 + +m[2] : null;
}
export const DOW_LABEL = ['일', '월', '화', '수', '목', '금', '토']; // kept for compat

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
  if (!e || e.closed) return t('hours.closed');
  if (is24(e)) return t('hours.24h');
  const c = e.close === '00:00' ? '24:00' : e.close;
  return `${e.open} ~ ${c}`;
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
  return w.map((e) => ({ label: t(`dow.${e.dow}`), text: entryText(e), isToday: e.dow === today }));
}

// filters: {
//   multiFloor, hasView, openNow, openLate,
//   sizes: Set, minOutlet: 'none'|'few'|'some'|'many',
//   maxPrice, minQuiet, minCoffee, minRestroom
// }
export function passesFilters(cafe, f) {
  if (f.multiFloor && !cafe.multi_floor) return false;
  if (f.hasView && !cafe.has_view) return false;
  if (f.rainOk && !cafe.rain_ok) return false;
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

// Small (~480px) variant for cards/grid. Locally-uploaded photos have a
// pre-generated "_thumb.jpg" (see server/images.js); external URLs are left
// as-is (handled by img()). Wrap with img() at the call site.
export function thumb(url) {
  if (url && url.startsWith('/uploads/')) return url.replace(/\.[^.]+$/, '_thumb.jpg');
  return url;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
