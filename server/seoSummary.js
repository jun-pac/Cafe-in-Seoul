'use strict';

// Generates & stores the AI search-engine summary (ai_summary + ai_summary_en) for
// cafes: one dense paragraph synthesizing every field + crowd votes + the owner's
// verdict — the crawlable prose the structured fields alone don't provide. It renders
// on the SEO page (and feeds collection blurbs), NOT the interactive map UI.
// Best-effort throughout: never throws into a request path or a boot timer.

const db = require('./db');
const ai = require('./ai');
const { aggregateVotes } = require('./cafeModel');

// (Re)generate one cafe's summary from its current data. Writes ko + en.
async function generateCafe(id) {
  if (!ai.HAS_AI) return;
  try {
    const cafe = db.prepare('SELECT * FROM cafes WHERE id = ?').get(id);
    if (!cafe) return;
    const { averages } = aggregateVotes(id);
    const ko = await ai.seoSummary(cafe, averages);
    if (!ko) return;
    const [en] = await ai.translateBatch([ko]);
    db.prepare('UPDATE cafes SET ai_summary = ?, ai_summary_en = ? WHERE id = ?').run(ko, en || null, id);
  } catch { /* best-effort */ }
}

// Fill any non-rejected cafe missing a summary. Cheap when nothing's missing (one scan).
// Runs at boot + on a timer so a one-time backfill and a credit lapse both self-heal.
async function backfillMissing() {
  if (!ai.HAS_AI) return { done: 0 };
  let done = 0;
  try {
    const rows = db.prepare(
      "SELECT id FROM cafes WHERE status != 'rejected' AND (ai_summary IS NULL OR trim(ai_summary) = '')"
    ).all();
    for (const r of rows) { await generateCafe(r.id); done++; }
    if (done) console.log(`[seo] generated ${done} AI summary(ies)`);
  } catch { /* best-effort */ }
  return { done };
}

module.exports = { generateCafe, backfillMissing };
