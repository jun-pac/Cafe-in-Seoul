'use strict';

// Generates & stores the AI search-engine summary (ai_summary + ai_summary_en) for
// cafes: one dense paragraph synthesizing every field + crowd votes + the owner's
// verdict — the crawlable prose the structured fields alone don't provide. It renders
// on the SEO page + the app detail panel, and feeds collection blurbs.
// Best-effort throughout: never throws into a request path or a boot timer.

const db = require('./db');
const ai = require('./ai');
const { aggregateVotes } = require('./cafeModel');

const DAY_MS = 24 * 60 * 60 * 1000;

// (Re)generate one cafe's summary from its current data. Writes ko + en + timestamp.
// Unconditional — callers decide whether to throttle (see regenerateOnEdit).
async function generateCafe(id) {
  if (!ai.HAS_AI) return;
  try {
    const cafe = db.prepare('SELECT * FROM cafes WHERE id = ?').get(id);
    if (!cafe) return;
    const { averages } = aggregateVotes(id);
    const ko = await ai.seoSummary(cafe, averages);
    if (!ko) return;
    const [en] = await ai.translateBatch([ko]);
    db.prepare("UPDATE cafes SET ai_summary = ?, ai_summary_en = ?, ai_summary_at = datetime('now') WHERE id = ?")
      .run(ko, en || null, id);
  } catch { /* best-effort */ }
}

// Regenerate after a content edit — but at most once per 24h per cafe, so repeated
// edits (or bursts) don't spam the LLM. Vote-only changes never call this (no hook on
// the vote route), so star ratings alone never trigger a re-summary.
async function regenerateOnEdit(id) {
  if (!ai.HAS_AI) return;
  try {
    const row = db.prepare('SELECT ai_summary, ai_summary_at FROM cafes WHERE id = ?').get(id);
    if (row && row.ai_summary && row.ai_summary_at) {
      const at = Date.parse(row.ai_summary_at.replace(' ', 'T') + 'Z'); // stored as UTC datetime('now')
      if (Number.isFinite(at) && (Date.now() - at) < DAY_MS) return; // throttled: already summarized today
    }
    await generateCafe(id);
  } catch { /* best-effort */ }
}

// Fill any non-rejected cafe MISSING a summary. Cheap when nothing's missing (one scan).
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

// Force-regenerate EVERY non-rejected cafe (ignores the daily throttle). For a
// one-time refresh after the prompt changes. Admin-triggered; runs in-process.
async function regenerateAll() {
  if (!ai.HAS_AI) return { done: 0 };
  let done = 0;
  const rows = db.prepare("SELECT id FROM cafes WHERE status != 'rejected'").all();
  for (const r of rows) { try { await generateCafe(r.id); done++; } catch { /* skip */ } }
  console.log(`[seo] force-regenerated ${done} AI summary(ies)`);
  return { done };
}

module.exports = { generateCafe, regenerateOnEdit, backfillMissing, regenerateAll };
