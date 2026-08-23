'use strict';

// Repair the photo library's derived files (never touches the DB):
//   - originals that escaped the 1600px/q82 pass (too big) → recompress main + thumb
//   - thumbnails that are missing or never got shrunk (>600px / >150KB) → regenerate thumb
// Skips already-good files, so it's safe to re-run. Regenerating a thumb re-reads the
// (already compressed) main, so it does NOT re-compress good originals (no quality loss).
// Run inside the container:  docker compose exec app node scripts/fix-thumbnails.js [--apply]

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { processUploadFile, thumbPathFor } = require('../server/images');

const UPLOADS = path.join(__dirname, '..', 'uploads');
const APPLY = process.argv.includes('--apply');
const THUMB = { width: 480, height: 480, fit: 'inside', withoutEnlargement: true };

(async () => {
  const files = fs.readdirSync(UPLOADS);
  const origs = files.filter((f) => /\.(jpe?g|png|webp)$/i.test(f) && !/_thumb\.[^.]+$/i.test(f));
  let fixedMain = 0, fixedThumb = 0;

  for (const f of origs) {
    const full = path.join(UPLOADS, f);
    const size = fs.statSync(full).size;
    if (size <= 100) continue; // placeholder

    let ow = 0; try { ow = (await sharp(full, { failOn: 'none' }).metadata()).width; } catch { continue; }
    const tn = thumbPathFor(f);
    const tp = path.join(UPLOADS, tn);
    const hasThumb = files.includes(tn);
    let tw = 0, tsize = 0;
    if (hasThumb) { tsize = fs.statSync(tp).size; try { tw = (await sharp(tp).metadata()).width; } catch { tw = 9999; } }

    const oversizedOrig = size > 1024 * 1024 || ow > 1700;
    const brokenThumb = !hasThumb || tw > 600 || tsize > 150 * 1024;

    if (oversizedOrig) {
      console.log(`RECOMPRESS ${f}  (${Math.round(size / 1024)}KB ${ow}px → main+thumb)`);
      if (APPLY) { await processUploadFile(f); fixedMain++; fixedThumb++; }
    } else if (brokenThumb) {
      console.log(`THUMB      ${f}  (thumb ${hasThumb ? `${Math.round(tsize / 1024)}KB ${tw}px` : 'MISSING'} → 480px)`);
      if (APPLY) {
        const buf = await sharp(full, { failOn: 'none' }).rotate().resize(THUMB).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
        fs.writeFileSync(tp, buf);
        fixedThumb++;
      }
    }
  }

  console.log(APPLY
    ? `\nAPPLIED — recompressed ${fixedMain} original(s), (re)generated ${fixedThumb} thumbnail(s)`
    : `\nDRY RUN — re-run with --apply to write. (listed above)`);
})();
