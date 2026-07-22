// Client-side study score — mirrors server/score.js exactly for the DEFAULT weights, but the
// weights are adjustable per user (stored in localStorage, personal, never shared). So an
// un-customized user sees the same score the server computed; a customized user re-ranks their
// own map. Only cafes use this score (view-spots rank by 따봉).

export const DEFAULT_WEIGHTS = { price: 18, outlets: 9, floors: 7, late: 6, size: 6, view: 4, quiet: 3, coffee: 1, restroom: 1 };
export const WEIGHT_META = [ // for the editor UI (label + which half + max slider)
  { key: 'price', label: '아아 가격', labelEn: 'Iced-Am price', half: 'field', max: 30 },
  { key: 'outlets', label: '콘센트', labelEn: 'Outlets', half: 'field', max: 30 },
  { key: 'floors', label: '다층', labelEn: 'Multi-floor', half: 'field', max: 30 },
  { key: 'late', label: '늦게까지', labelEn: 'Open late', half: 'field', max: 30 },
  { key: 'size', label: '면적', labelEn: 'Size', half: 'field', max: 30 },
  { key: 'view', label: '뷰', labelEn: 'View', half: 'field', max: 30 },
  { key: 'quiet', label: '조용함', labelEn: 'Quiet', half: 'vote', max: 6 },
  { key: 'coffee', label: '커피맛', labelEn: 'Coffee', half: 'vote', max: 6 },
  { key: 'restroom', label: '화장실', labelEn: 'Restroom', half: 'vote', max: 6 },
];

export function getWeights() {
  try { const w = JSON.parse(localStorage.getItem('scoreWeights') || 'null'); if (w && typeof w === 'object') return { ...DEFAULT_WEIGHTS, ...w }; } catch { /* */ }
  return { ...DEFAULT_WEIGHTS };
}
export function setWeights(w) { try { localStorage.setItem('scoreWeights', JSON.stringify(w)); } catch { /* */ } }
export function resetWeights() { try { localStorage.removeItem('scoreWeights'); } catch { /* */ } }
export function isCustomized() { try { return !!localStorage.getItem('scoreWeights'); } catch { return false; } }

const P_CHEAP = 3500, P_EXP = 7000;
function priceScore(price, w) {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return w * 0.5; // unknown → mid
  if (p <= P_CHEAP) return w;
  if (p >= P_EXP) return 0;
  return w * (P_EXP - p) / (P_EXP - P_CHEAP);
}
function toMinutes(hhmm) { if (!hhmm || typeof hhmm !== 'string') return null; const m = hhmm.match(/^(\d{1,2}):(\d{2})$/); return m ? +m[1] * 60 + +m[2] : null; }
function opensLate(o, c) { const a = toMinutes(o), b = toMinutes(c); if (a == null || b == null) return false; if (b <= a) return true; return b >= 22 * 60; }

// { total, discrete, crowd, parts:[{key,label,points,max}], votes:{quiet,coffee,restroom} }
export function scoreBreakdown(cafe, w = getWeights()) {
  const r1 = (x) => Math.round(x * 10) / 10;
  const parts = [];
  const price = priceScore(cafe.iced_americano_price, w.price);
  const floors = Number(cafe.floors) >= 2 ? w.floors : 0;
  const of = ({ many: 1, some: 2 / 3, few: 1 / 3, none: 0 })[cafe.outlets] ?? 0;
  const sf = ({ large: 1, medium: 2 / 3, small: 1 / 3 })[cafe.size] ?? 0;
  const view = (cafe.has_view === true || Number(cafe.has_view) === 1) ? w.view : 0;
  const late = opensLate(cafe.open_time, cafe.close_time) ? w.late : 0;
  parts.push({ key: 'price', label: '아아 가격', points: r1(price), max: w.price });
  parts.push({ key: 'outlets', label: '콘센트', points: r1(of * w.outlets), max: w.outlets });
  parts.push({ key: 'floors', label: '다층', points: r1(floors), max: w.floors });
  parts.push({ key: 'late', label: '늦게까지', points: r1(late), max: w.late });
  parts.push({ key: 'size', label: '면적', points: r1(sf * w.size), max: w.size });
  parts.push({ key: 'view', label: '뷰', points: r1(view), max: w.view });
  const discrete = Math.min(50, price + floors + of * w.outlets + sf * w.size + view + late);

  const a = cafe.votes?.averages || {};
  const q = a.quiet ?? 3, c = a.coffee ?? 3, rr = a.restroom ?? 3;
  const wsum = (w.quiet + w.coffee + w.restroom) || 1;
  const weighted = (q * w.quiet + c * w.coffee + rr * w.restroom) / wsum; // 1..5
  const crowd = ((weighted - 1) / 4) * 50;

  return {
    total: Math.round(discrete + crowd),
    discrete: r1(discrete), crowd: r1(crowd), parts, weights: w,
    votes: { quiet: a.quiet ?? null, coffee: a.coffee ?? null, restroom: a.restroom ?? null },
  };
}
export function computeScore(cafe, w) { return scoreBreakdown(cafe, w).total; }
