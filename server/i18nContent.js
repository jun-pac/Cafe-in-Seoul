'use strict';

// AI translation of user-facing content into English, stored in *_en columns and shown when
// the UI language is English. Best-effort: never throws into a request path.
const db = require('./db');
const ai = require('./ai');

const CAFE_FIELDS = ['name', 'address', 'study_review', 'view_note', 'review_summary'];
// Which fields each table lets an admin correct by hand (must have a matching *_en column).
const TRANSLATABLE = { cafes: CAFE_FIELDS, viewspots: ['name', 'region'] };

// Deterministic English for regions the model romanizes wrong — e.g. brand-new
// admin districts it hasn't seen (인천 제물포구, created 2026, → hallucinated "Jeongneung-dong").
const REGION_EN = { '인천 제물포구': 'Jemulpo-gu, Incheon' };

// Fields an admin has hand-corrected — never overwrite these from AI again.
const lockRows = db.prepare('SELECT field FROM i18n_locks WHERE tbl = ? AND row_id = ?');
const lockedFields = (table, id) => new Set(lockRows.all(table, id).map((r) => r.field));

// Translate the given (Korean) fields of one row and write them to their _en columns.
async function translateRow(table, id, fields) {
  if (!ai.HAS_AI) return;
  try {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!row) return;
    const locked = lockedFields(table, id); // admin-corrected fields are left alone
    const todo = fields.filter((f) => (row[f] || '').trim() && !locked.has(f));
    if (!todo.length) return;
    const outs = await ai.translateBatch(todo.map((f) => row[f]));
    const sets = [], params = { id };
    todo.forEach((f, i) => {
      const out = (f === 'region' && REGION_EN[row[f]]) || outs[i]; // known-wrong regions overridden
      if (out) { sets.push(`${f}_en = @p${i}`); params[`p${i}`] = out; }
    });
    if (sets.length) db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = @id`).run(params);
  } catch { /* translation is best-effort */ }
}

const translateCafe = (id) => translateRow('cafes', id, CAFE_FIELDS);
const translateViewspot = (id) => translateRow('viewspots', id, ['name', 'region']);
const translateReview = (id) => translateRow('reviews', id, ['body']);
const translateComment = (id) => translateRow('viewspot_comments', id, ['body']);

// Self-heal: translation is best-effort, so anything registered while the OpenAI key
// was out of credit silently kept null _en columns. This finds those rows and fills
// them, so a lapse repairs itself once credit returns (no manual re-run needed).
// Cheap when nothing's missing — it's just a couple of indexed COUNT-style scans.
const missing = (src, en) => `(trim(coalesce(${src},''))!='' AND (${en} IS NULL OR ${en}=''))`;
async function retranslateMissing() {
  if (!ai.HAS_AI) return;
  try {
    // region comes from Kakao (not the AI credit) — backfill any that never got one first
    const kakao = require('./kakao');
    if (kakao.HAS_KAKAO) {
      const noRegion = db.prepare("SELECT id, lat, lng FROM viewspots WHERE (region IS NULL OR region='') AND status!='rejected'").all();
      for (const v of noRegion) { try { const r = await kakao.reverseRegion(v.lng, v.lat); if (r) db.prepare('UPDATE viewspots SET region=? WHERE id=?').run(r, v.id); } catch { /* skip */ } }
    }
    const cafeWhere = CAFE_FIELDS.map((f) => missing(f, `${f}_en`)).join(' OR ');
    const cafes = db.prepare(`SELECT id FROM cafes WHERE status!='rejected' AND (${cafeWhere})`).all();
    for (const c of cafes) await translateCafe(c.id);
    const vs = db.prepare(`SELECT id FROM viewspots WHERE status!='rejected' AND (${missing('name', 'name_en')} OR ${missing('region', 'region_en')})`).all();
    for (const v of vs) await translateViewspot(v.id);
    if (cafes.length || vs.length) console.log(`[i18n] re-translated ${cafes.length} cafe(s), ${vs.length} view-spot(s) that were missing English`);
  } catch { /* best-effort, never throw into a timer/boot */ }
}

// ---- manual overrides (admin translation editor) ----------------------------
const setLock = db.prepare(`INSERT INTO i18n_locks (tbl, row_id, field, updated_at)
  VALUES (@tbl, @row_id, @field, datetime('now'))
  ON CONFLICT(tbl, row_id, field) DO UPDATE SET updated_at = excluded.updated_at`);
const dropLock = db.prepare('DELETE FROM i18n_locks WHERE tbl = ? AND row_id = ? AND field = ?');

// Save an admin-corrected English value and lock the field so AI never overwrites it.
// Returns { ok } or throws on a bad table/field. value '' clears the _en (still locked → stays blank).
function setManual(table, id, field, value) {
  const allowed = TRANSLATABLE[table];
  if (!allowed || !allowed.includes(field)) throw new Error('bad table/field');
  const row = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id);
  if (!row) throw new Error('not found');
  const v = value == null ? null : String(value).trim().slice(0, 2000);
  db.prepare(`UPDATE ${table} SET ${field}_en = ? WHERE id = ?`).run(v || null, id);
  setLock.run({ tbl: table, row_id: id, field });
  return { ok: true };
}

// Remove the lock and re-run AI translation for that field (revert to automatic).
async function clearManual(table, id, field) {
  const allowed = TRANSLATABLE[table];
  if (!allowed || !allowed.includes(field)) throw new Error('bad table/field');
  dropLock.run(table, id, field);
  await translateRow(table, id, [field]); // regenerate now that it's unlocked
  return { ok: true };
}

// Rows for the admin translation editor: Korean source + current English + lock flag,
// for the identity fields most visible in the UI/SEO (names, plus address/region).
function reviewList(table) {
  const fields = table === 'cafes' ? ['name', 'address'] : ['name', 'region'];
  if (!TRANSLATABLE[table]) return [];
  const cols = ['id', ...fields, ...fields.map((f) => `${f}_en`)].join(', ');
  const rows = db.prepare(`SELECT ${cols} FROM ${table} WHERE status != 'rejected' ORDER BY name COLLATE NOCASE`).all();
  const lockedAll = db.prepare('SELECT row_id, field FROM i18n_locks WHERE tbl = ?').all(table);
  const lockMap = {};
  for (const l of lockedAll) (lockMap[l.row_id] = lockMap[l.row_id] || {})[l.field] = true;
  return { fields, rows: rows.map((r) => ({ ...r, locked: lockMap[r.id] || {} })) };
}

module.exports = { translateRow, translateCafe, translateViewspot, translateReview, translateComment, retranslateMissing, CAFE_FIELDS, TRANSLATABLE, setManual, clearManual, reviewList };
