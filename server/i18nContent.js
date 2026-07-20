'use strict';

// AI translation of user-facing content into English, stored in *_en columns and shown when
// the UI language is English. Best-effort: never throws into a request path.
const db = require('./db');
const ai = require('./ai');

const CAFE_FIELDS = ['name', 'address', 'study_review', 'view_note', 'review_summary'];

// Translate the given (Korean) fields of one row and write them to their _en columns.
async function translateRow(table, id, fields) {
  if (!ai.HAS_AI) return;
  try {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!row) return;
    const todo = fields.filter((f) => (row[f] || '').trim());
    if (!todo.length) return;
    const outs = await ai.translateBatch(todo.map((f) => row[f]));
    const sets = [], params = { id };
    todo.forEach((f, i) => { if (outs[i]) { sets.push(`${f}_en = @p${i}`); params[`p${i}`] = outs[i]; } });
    if (sets.length) db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = @id`).run(params);
  } catch { /* translation is best-effort */ }
}

const translateCafe = (id) => translateRow('cafes', id, CAFE_FIELDS);
const translateViewspot = (id) => translateRow('viewspots', id, ['name']);
const translateReview = (id) => translateRow('reviews', id, ['body']);
const translateComment = (id) => translateRow('viewspot_comments', id, ['body']);

module.exports = { translateRow, translateCafe, translateViewspot, translateReview, translateComment, CAFE_FIELDS };
