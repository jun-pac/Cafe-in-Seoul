'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  provider     TEXT NOT NULL,          -- 'google' | 'dev'
  provider_id  TEXT NOT NULL,
  email        TEXT,
  name         TEXT NOT NULL,
  avatar_url   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, provider_id)
);

CREATE TABLE IF NOT EXISTS cafes (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  address         TEXT,
  lat             REAL NOT NULL,
  lng             REAL NOT NULL,
  photo_url       TEXT NOT NULL,             -- representative photo (required)

  -- the 7 required discrete fields
  floors          INTEGER NOT NULL,          -- number of floors (>=2 => multi-floor)
  open_time       TEXT NOT NULL,             -- 'HH:MM'
  close_time      TEXT NOT NULL,             -- 'HH:MM' (may be < open for past-midnight)
  size            TEXT NOT NULL,             -- 'small' | 'medium' | 'large'
  naver_url       TEXT NOT NULL,
  kakao_url       TEXT NOT NULL,
  iced_americano_price INTEGER NOT NULL,     -- KRW
  has_view        INTEGER NOT NULL,          -- 0/1
  view_note       TEXT,                      -- optional short description of the view
  outlets         TEXT NOT NULL,             -- 'many' | 'some' | 'few' | 'none'

  created_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- 1-5 crowd votes across three subjective categories
CREATE TABLE IF NOT EXISTS votes (
  cafe_id   TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  category  TEXT NOT NULL,   -- 'coffee' | 'quiet' | 'restroom'
  score     INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (cafe_id, user_id, category),
  FOREIGN KEY (cafe_id) REFERENCES cafes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reviews (
  id         TEXT PRIMARY KEY,
  cafe_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  body       TEXT NOT NULL,
  photo_url  TEXT,                        -- legacy single photo (kept for compat)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (cafe_id) REFERENCES cafes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- cafe-level photos (representative = ord 0), set at registration/edit
CREATE TABLE IF NOT EXISTS cafe_photos (
  id       TEXT PRIMARY KEY,
  cafe_id  TEXT NOT NULL,
  url      TEXT NOT NULL,
  ord      INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (cafe_id) REFERENCES cafes(id) ON DELETE CASCADE
);

-- multiple photos per story/review (Instagram-style)
CREATE TABLE IF NOT EXISTS review_photos (
  id         TEXT PRIMARY KEY,
  review_id  TEXT NOT NULL,
  cafe_id    TEXT NOT NULL,
  url        TEXT NOT NULL,
  ord        INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE,
  FOREIGN KEY (cafe_id) REFERENCES cafes(id) ON DELETE CASCADE
);

-- per-cafe chat; posting is gated on GPS proximity (<=1km) server-side
CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  cafe_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (cafe_id) REFERENCES cafes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- scenic "view" spots: a separate, lighter place type (name + photos + comments)
CREATE TABLE IF NOT EXISTS viewspots (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  photo_url  TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS viewspot_photos (
  id          TEXT PRIMARY KEY,
  viewspot_id TEXT NOT NULL,
  url         TEXT NOT NULL,
  ord         INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (viewspot_id) REFERENCES viewspots(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS viewspot_comments (
  id          TEXT PRIMARY KEY,
  viewspot_id TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (viewspot_id) REFERENCES viewspots(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_vsphotos ON viewspot_photos(viewspot_id, ord);
CREATE INDEX IF NOT EXISTS idx_vscomments ON viewspot_comments(viewspot_id, created_at);

CREATE INDEX IF NOT EXISTS idx_votes_cafe    ON votes(cafe_id);
CREATE INDEX IF NOT EXISTS idx_reviews_cafe  ON reviews(cafe_id);
CREATE INDEX IF NOT EXISTS idx_messages_cafe ON messages(cafe_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rphotos_cafe  ON review_photos(cafe_id);
CREATE INDEX IF NOT EXISTS idx_rphotos_rev   ON review_photos(review_id, ord);
CREATE INDEX IF NOT EXISTS idx_cphotos_cafe  ON cafe_photos(cafe_id, ord);
`);

// --- lightweight migrations (add columns if an older DB is missing them) ---
const cafeCols = new Set(db.prepare(`PRAGMA table_info(cafes)`).all().map((c) => c.name));
if (!cafeCols.has('review_summary')) {
  db.exec(`ALTER TABLE cafes ADD COLUMN review_summary TEXT`); // AI summary of external reviews
}
if (!cafeCols.has('kakao_place_id')) {
  db.exec(`ALTER TABLE cafes ADD COLUMN kakao_place_id TEXT`); // source place id when imported from Kakao
}
if (!cafeCols.has('status')) {
  // 'approved' (public) | 'pending' (awaiting admin review, hidden from others)
  db.exec(`ALTER TABLE cafes ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'`);
}
if (!cafeCols.has('moderation_reason')) {
  db.exec(`ALTER TABLE cafes ADD COLUMN moderation_reason TEXT`);
}
if (!cafeCols.has('hours_json')) {
  // per-weekday hours: JSON array [{dow:0-6, open, close, closed?}] (dow 0=Sun)
  db.exec(`ALTER TABLE cafes ADD COLUMN hours_json TEXT`);
}

const userCols = new Set(db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name));
if (!userCols.has('password_hash')) {
  db.exec(`ALTER TABLE users ADD COLUMN password_hash TEXT`); // for provider='local' (id/pw) accounts
}
if (!userCols.has('is_admin')) {
  db.exec(`ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0`);
}

// --- safety net: timestamped DB backup on startup (keep last 20) ---
// So no operation is ever irreversible: if data is lost, restore from data/backups/.
try {
  const backupsDir = path.join(DATA_DIR, 'backups');
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
  const rows = db.prepare('SELECT (SELECT COUNT(*) FROM cafes) + (SELECT COUNT(*) FROM users) + (SELECT COUNT(*) FROM viewspots) AS n').get().n;
  if (rows > 0) {
    db.pragma('wal_checkpoint(TRUNCATE)'); // flush WAL into the main file first
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fs.copyFileSync(path.join(DATA_DIR, 'app.db'), path.join(backupsDir, `app-${stamp}.db`));
    const files = fs.readdirSync(backupsDir).filter((f) => /^app-.*\.db$/.test(f)).sort();
    for (const f of files.slice(0, -20)) fs.unlinkSync(path.join(backupsDir, f)); // prune to 20
  }
} catch (e) {
  console.error('DB backup skipped:', e.message);
}

module.exports = db;
