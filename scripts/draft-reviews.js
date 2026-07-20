'use strict';
// One-time (idempotent): generate a concise AI 카공 총평 draft for every cafe that
// lacks one. The admin reviews/edits it later. Skips cafes that already have one.
const db = require('../server/db');
const { draftStudyReview, HAS_AI } = require('../server/ai');

(async () => {
  if (!HAS_AI) { console.log('OPENAI_API_KEY 없음 → 중단'); process.exit(0); }
  const cafes = db.prepare(
    "SELECT * FROM cafes WHERE (study_review IS NULL OR trim(study_review) = '') AND status != 'rejected'"
  ).all();
  console.log(`${cafes.length}개 카페에 카공 총평 초안 생성...`);
  const upd = db.prepare('UPDATE cafes SET study_review = ? WHERE id = ?');
  let done = 0;
  for (const c of cafes) {
    try {
      const draft = await draftStudyReview(c);
      if (draft) { upd.run(draft, c.id); done++; console.log('  ✓', c.name); }
      else console.log('  - (초안 없음)', c.name);
    } catch (e) { console.log('  ❌', c.name, e.message); }
  }
  console.log(`완료: ${done}/${cafes.length}`);
  process.exit(0);
})();
