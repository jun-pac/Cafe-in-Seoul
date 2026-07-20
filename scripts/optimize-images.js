'use strict';
// One-time (idempotent) pass over existing uploads: compress each main image and
// generate its _thumb.jpg. Safe to re-run — files that already have a thumbnail
// are skipped. Never deletes originals' URLs (compresses in place).
const fs = require('fs');
const path = require('path');
const { processUploadFile, thumbPathFor } = require('../server/images');

const UPLOADS = path.join(__dirname, '..', 'uploads');

(async () => {
  const all = fs.readdirSync(UPLOADS)
    .filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f) && !/_thumb\.jpg$/i.test(f));
  let done = 0, skipped = 0, before = 0, after = 0;
  for (const f of all) {
    if (fs.existsSync(path.join(UPLOADS, thumbPathFor(f)))) { skipped++; continue; }
    before += fs.statSync(path.join(UPLOADS, f)).size;
    await processUploadFile(f);
    after += fs.statSync(path.join(UPLOADS, f)).size;
    done++;
    if (done % 10 === 0) console.log(`  ${done} processed…`);
  }
  console.log(`\n최적화 완료: ${done}개 처리, ${skipped}개 건너뜀(이미 최적화됨)`);
  if (done) {
    console.log(`메인 이미지 용량: ${(before / 1048576).toFixed(1)}MB → ${(after / 1048576).toFixed(1)}MB`
      + ` (${(before / Math.max(after, 1)).toFixed(1)}x 감소), 썸네일 ${done}개 생성`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
