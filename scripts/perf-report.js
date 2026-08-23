'use strict';

// One-shot latency / weight audit. Deeper than the live /api/admin/perf dashboard —
// it opens every image with sharp to report real pixel dimensions, and sizes the DB.
// Run inside the container:  docker compose exec app node scripts/perf-report.js
// (Read-only. Never writes or deletes anything.)

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const UPLOADS = path.join(ROOT, 'uploads');
const DB_PATH = path.join(ROOT, 'data', 'app.db');

const kb = (b) => `${Math.round(b / 1024)} KB`;
const mb = (b) => `${(b / 1048576).toFixed(1)} MB`;
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
function quant(nums) {
  if (!nums.length) return 'n/a';
  const s = [...nums].sort((a, b) => a - b);
  return `min ${s[0]}  p50 ${pct(s, 0.5)}  p90 ${pct(s, 0.9)}  p99 ${pct(s, 0.99)}  max ${s[s.length - 1]}`;
}
const h = (s) => console.log(`\n\x1b[1m${s}\x1b[0m`);

(async () => {
  console.log('=== QuietPlaceSeoul latency / weight audit ===', new Date().toISOString());

  // ---- photo library ----
  h('PHOTOS (uploads/)');
  const files = fs.readdirSync(UPLOADS);
  const isImg = (f) => /\.(jpe?g|png|webp)$/i.test(f);
  const origs = files.filter((f) => isImg(f) && !/_thumb\.[^.]+$/i.test(f));

  const oW = [], oBytes = [], missingThumb = [], bigOrig = [], badThumb = [];
  let totalOrig = 0, totalThumb = 0, tCount = 0;
  for (const f of origs) {
    const size = fs.statSync(path.join(UPLOADS, f)).size;
    if (size <= 100) continue; // placeholder
    totalOrig += size; oBytes.push(size);
    let ow = 0;
    try { const m = await sharp(path.join(UPLOADS, f)).metadata(); ow = m.width; oW.push(m.width); } catch { /* skip */ }
    if (size > 1024 * 1024 || ow > 1700) bigOrig.push(`${f}  ${kb(size)} ${ow}px`);
    const tn = `${f.replace(/\.[^.]+$/, '')}_thumb.jpg`;
    if (!files.includes(tn)) { missingThumb.push(f); continue; }
    const ts = fs.statSync(path.join(UPLOADS, tn)).size; totalThumb += ts; tCount++;
    let tw = 0; try { tw = (await sharp(path.join(UPLOADS, tn)).metadata()).width; } catch { /* skip */ }
    if (ts > 150 * 1024 || tw > 600) badThumb.push(`${tn}  ${kb(ts)} ${tw}px`);
  }
  console.log(`originals: ${oBytes.length}  total ${mb(totalOrig)}  avg ${kb(totalOrig / (oBytes.length || 1))}`);
  console.log(`thumbs:    ${tCount}  total ${mb(totalThumb)}  avg ${kb(totalThumb / (tCount || 1))}`);
  console.log(`original width px:  ${quant(oW)}`);
  console.log(`original bytes:     ${quant(oBytes.map((b) => Math.round(b / 1024)))} (KB)`);
  console.log(`\nif ALL card thumbs load at once (map view): ~${mb(totalThumb)}`);
  console.log(`if ALL full images load at once (never should): ~${mb(totalOrig)}`);
  console.log(`\nmissing thumbnails (${missingThumb.length}): ${missingThumb.slice(0, 20).join(', ') || 'none'}`);
  console.log(`oversized ORIGINALS >1MB or >1700px (${bigOrig.length}):`);
  bigOrig.slice(0, 20).forEach((x) => console.log('  ' + x));
  console.log(`BROKEN thumbnails >150KB or >600px (${badThumb.length}) — regenerate these:`);
  badThumb.slice(0, 20).forEach((x) => console.log('  ' + x));

  // ---- database ----
  h('DATABASE');
  try {
    const st = fs.statSync(DB_PATH);
    console.log(`app.db: ${mb(st.size)}`);
    for (const w of ['-wal', '-shm']) {
      try { console.log(`app.db${w}: ${mb(fs.statSync(DB_PATH + w).size)}`); } catch { /* none */ }
    }
    const Database = require('better-sqlite3');
    const db = new Database(DB_PATH, { readonly: true });
    for (const t of ['cafes', 'viewspots', 'events', 'reviews', 'viewspot_comments', 'i18n_locks']) {
      try { console.log(`  ${t}: ${db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n} rows`); } catch { /* table may not exist */ }
    }
    // biggest events days (a runaway logger shows up here)
    const busiest = db.prepare("SELECT date(ts,'+9 hours') d, COUNT(*) n FROM events GROUP BY d ORDER BY n DESC LIMIT 3").all();
    console.log('  busiest event days (KST):', busiest.map((r) => `${r.d}=${r.n}`).join('  '));
  } catch (e) { console.log('db check failed:', e.message); }

  h('NOTES');
  console.log('- map cards + markers use 480px thumbs; the detail hero + lightbox load full ≤1600px images.');
  console.log('- /uploads is cached 7d (immutable filenames); /api/img (external CDN) cached 7d.');
  console.log('- fix broken thumbnails with: node scripts/fix-thumbnails.js');
  console.log('- live per-route timings + real-user LCP: admin panel → 성능 tab (or GET /api/admin/perf).');
})();
