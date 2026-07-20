'use strict';

// Overall "study score" 0..100. Used to (a) rank cafes and (b) decide which
// photo-card survives when cards overlap as you zoom out (highest score wins).
//
// Two halves:
//   - discrete half (max 50): objective, from the required registration fields
//   - crowd half   (max 50): from 1-5 votes (quietness weighted heaviest)

function toMinutes(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// Does the cafe close at/after 22:00 (or run past midnight / 24h)?
function opensLate(open_time, close_time) {
  const o = toMinutes(open_time);
  const c = toMinutes(close_time);
  if (o == null || c == null) return false;
  if (c <= o) return true;            // past-midnight or 24h
  return c >= 22 * 60;                // closes 22:00 or later
}

// Iced-americano price → 0..18. Cheap is a big deal for study cafes, so this is
// the single heaviest discrete factor. <=3,500won gets full marks, >=7,000 zero.
const P_CHEAP = 3500, P_EXP = 7000, P_WEIGHT = 18;
function priceScore(price) {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return P_WEIGHT * 0.5; // unknown -> mid
  if (p <= P_CHEAP) return P_WEIGHT;
  if (p >= P_EXP) return 0;
  return P_WEIGHT * (P_EXP - p) / (P_EXP - P_CHEAP);
}

function discreteScore(cafe) {
  let s = 0;
  s += priceScore(cafe.iced_americano_price);         // cheap coffee: the biggest factor

  if (Number(cafe.floors) >= 2) s += 7;               // multi-floor: less pressure to leave

  const outlets = { many: 9, some: 6, few: 3, none: 0 };
  s += outlets[cafe.outlets] ?? 0;

  const size = { large: 6, medium: 4, small: 2 };
  s += size[cafe.size] ?? 0;

  if (Number(cafe.has_view) === 1 || cafe.has_view === true) s += 4;

  if (opensLate(cafe.open_time, cafe.close_time)) s += 6;

  return Math.min(50, s);            // cap at 50
}

// averages: { coffee, quiet, restroom } each 1..5 or null when no votes
function crowdScore(averages) {
  const neutral = 3;
  const coffee = averages?.coffee ?? neutral;
  const quiet = averages?.quiet ?? neutral;
  const restroom = averages?.restroom ?? neutral;
  // quietness matters most for studying
  const weighted = (quiet * 3 + coffee * 1 + restroom * 1) / 5; // 1..5
  return ((weighted - 1) / 4) * 50; // -> 0..50
}

function overallScore(cafe, averages) {
  return Math.round(discreteScore(cafe) + crowdScore(averages));
}

module.exports = { overallScore, discreteScore, crowdScore, opensLate, toMinutes };
