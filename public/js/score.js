// 카공(study) score — a fixed, explicit formula:
//
//   카공 점수 = 객관 필드 (0~50) + 집단지성 투표 (0~50)   → 0~100
//
//   객관 필드 = 50 × Σ(wᵢ · fᵢ) / Σ(wᵢ)     fᵢ = each factor normalized to 0..1
//   집단지성  = 50 × Σ(wⱼ · vⱼ) / Σ(wⱼ)     vⱼ = (투표평균 - 1) / 4   (1점→0, 5점→1)
//
// Each half is a WEIGHTED AVERAGE scaled to 50, so each half is always ≤ 50 no matter the
// weights — the 50/50 split is enforced; the weights only redistribute points WITHIN a half.
// Weights are personal (localStorage), never shared; defaults below == the server's.

export const DEFAULT_WEIGHTS = { price: 18, outlets: 9, floors: 7, late: 6, size: 6, view: 4, quiet: 3, coffee: 1, restroom: 1 };
export const OBJ_KEYS = ['price', 'outlets', 'floors', 'late', 'size', 'view'];
export const VOTE_KEYS = ['quiet', 'coffee', 'restroom'];
export const WEIGHT_META = [
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
function priceFrac(price) { // iced-americano price → 0..1 (cheap = 1)
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return 0.5; // unknown → mid
  if (p <= P_CHEAP) return 1;
  if (p >= P_EXP) return 0;
  return (P_EXP - p) / (P_EXP - P_CHEAP);
}
function toMinutes(hhmm) { if (!hhmm || typeof hhmm !== 'string') return null; const m = hhmm.match(/^(\d{1,2}):(\d{2})$/); return m ? +m[1] * 60 + +m[2] : null; }
function opensLate(o, c) { const a = toMinutes(o), b = toMinutes(c); if (a == null || b == null) return false; if (b <= a) return true; return b >= 22 * 60; }

// per-factor normalized subscore in 0..1
function frac(cafe, key) {
  switch (key) {
    case 'price': return priceFrac(cafe.iced_americano_price);
    case 'outlets': return ({ many: 1, some: 2 / 3, few: 1 / 3, none: 0 })[cafe.outlets] ?? 0;
    case 'floors': return Number(cafe.floors) >= 2 ? 1 : 0;
    case 'late': return opensLate(cafe.open_time, cafe.close_time) ? 1 : 0;
    case 'size': return ({ large: 1, medium: 2 / 3, small: 1 / 3 })[cafe.size] ?? 0;
    case 'view': return (cafe.has_view === true || Number(cafe.has_view) === 1) ? 1 : 0;
    default: return 0;
  }
}

// { total, objective, crowd, parts:[{key,points,max}], crowdParts:[{key,points,max,weight,avg}], weights }
export function scoreBreakdown(cafe, w = getWeights()) {
  const r1 = (x) => Math.round(x * 10) / 10;
  const objW = OBJ_KEYS.reduce((s, k) => s + Math.max(0, w[k] || 0), 0) || 1;
  const parts = OBJ_KEYS.map((k) => ({ key: k, points: r1(50 * (w[k] || 0) * frac(cafe, k) / objW), max: r1(50 * (w[k] || 0) / objW) }));
  const objRaw = OBJ_KEYS.reduce((s, k) => s + 50 * (w[k] || 0) * frac(cafe, k) / objW, 0);

  const a = cafe.votes?.averages || {};
  const voteFrac = (k) => (((a[k] ?? 3) - 1) / 4);
  const crowdW = VOTE_KEYS.reduce((s, k) => s + Math.max(0, w[k] || 0), 0) || 1;
  const crowdParts = VOTE_KEYS.map((k) => ({ key: k, weight: w[k] || 0, avg: a[k] ?? null, points: r1(50 * (w[k] || 0) * voteFrac(k) / crowdW), max: r1(50 * (w[k] || 0) / crowdW) }));
  const crowdRaw = VOTE_KEYS.reduce((s, k) => s + 50 * (w[k] || 0) * voteFrac(k) / crowdW, 0);

  // round the SUM once (matches server) so client and server totals stay identical for defaults
  return { total: Math.round(objRaw + crowdRaw), objective: r1(objRaw), crowd: r1(crowdRaw), parts, crowdParts, weights: w };
}
export function computeScore(cafe, w) { return scoreBreakdown(cafe, w).total; }
