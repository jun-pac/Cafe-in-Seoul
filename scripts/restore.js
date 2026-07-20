'use strict';
// One-command recovery. Lists timestamped backups and restores one into
// data/app.db — after first snapshotting the CURRENT db, so restoring is
// itself reversible. Never destroys history.
//
//   node scripts/restore.js            → list available backups
//   node scripts/restore.js latest     → restore the most recent backup
//   node scripts/restore.js <filename> → restore a specific backup

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
const BACKUPS = path.join(DATA_DIR, 'backups');
const LIVE = path.join(DATA_DIR, 'app.db');

function counts(file) {
  try {
    const d = new Database(file, { readonly: true, fileMustExist: true });
    const n = (t) => { try { return d.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c; } catch { return 0; } };
    const r = { cafes: n('cafes'), reviews: n('reviews'), photos: n('review_photos'), views: n('viewspots') };
    d.close();
    return r;
  } catch { return null; }
}

function list() {
  if (!fs.existsSync(BACKUPS)) return [];
  return fs.readdirSync(BACKUPS).filter((f) => /^app-.*\.db$/.test(f)).sort().reverse();
}

const files = list();
if (!files.length) { console.log('백업이 없습니다 (data/backups 비어있음).'); process.exit(0); }

const arg = process.argv[2];
if (!arg) {
  console.log('사용 가능한 백업 (최신순):\n');
  for (const f of files) {
    const c = counts(path.join(BACKUPS, f));
    console.log(`  ${f}  →  카페 ${c.cafes} · 후기 ${c.reviews} · 사진 ${c.photos} · 조망 ${c.views}`);
  }
  console.log('\n복원: node scripts/restore.js latest   또는   node scripts/restore.js <파일명>');
  process.exit(0);
}

const pick = arg === 'latest' ? files[0] : arg;
const src = path.join(BACKUPS, pick);
if (!fs.existsSync(src)) { console.error('그런 백업이 없습니다:', pick); process.exit(1); }

// snapshot current live db before overwriting, so this is reversible too
if (fs.existsSync(LIVE)) {
  const safe = path.join(BACKUPS, `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.db`);
  try { fs.copyFileSync(LIVE, safe); console.log('현재 DB를 먼저 백업:', path.basename(safe)); } catch { /* */ }
}
// clear WAL side-files so the restored snapshot is authoritative
for (const ext of ['-wal', '-shm']) { try { fs.unlinkSync(LIVE + ext); } catch { /* */ } }
fs.copyFileSync(src, LIVE);
const c = counts(LIVE);
console.log(`\n✓ 복원 완료: ${pick}\n  → 카페 ${c.cafes} · 후기 ${c.reviews} · 사진 ${c.photos} · 조망 ${c.views}`);
console.log('  서버를 재시작하면 반영됩니다.');
