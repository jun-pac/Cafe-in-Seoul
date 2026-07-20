'use strict';

// File-level backup for uploaded photos. Upload files are immutable (unique
// timestamped names, never overwritten), so mirroring is cheap: copy any file
// that isn't already in the mirror. This means a photo survives even if its DB
// row is deleted/orphaned OR the original file is removed — there is always a
// second copy. Runs at boot and every 10 minutes.
const fs = require('fs');
const path = require('path');

// mirror lives under data/backups/ — the one bind-mounted, host-persisted, container-writable
// location (same place the DB auto-backups go), so it survives container rebuilds.
const SRC = path.join(__dirname, '..', 'uploads');
const DST = path.join(__dirname, '..', 'data', 'backups', 'uploads-mirror');

function mirrorOnce() {
  try {
    fs.mkdirSync(DST, { recursive: true });
    const have = new Set(fs.readdirSync(DST));
    let copied = 0;
    for (const f of fs.readdirSync(SRC)) {
      if (f === '.gitkeep' || have.has(f)) continue;
      try { fs.copyFileSync(path.join(SRC, f), path.join(DST, f)); copied++; } catch { /* skip one bad file */ }
    }
    const total = fs.readdirSync(DST).length;
    if (copied) console.log(`[uploads-backup] +${copied} new file(s), ${total} total mirrored → data/backups/uploads-mirror`);
    return { copied, total };
  } catch (e) { console.log('[uploads-backup] error:', e.message); return { copied: 0, total: 0 }; }
}

function startUploadsBackup() {
  mirrorOnce();
  const t = setInterval(mirrorOnce, 10 * 60 * 1000);
  if (t.unref) t.unref();
}

module.exports = { startUploadsBackup, mirrorOnce };
