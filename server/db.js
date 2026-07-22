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
if (!cafeCols.has('study_review')) {
  // editorial 카공 총평 — the study-friendliness verdict (surveillance feel, openness, etc.)
  db.exec(`ALTER TABLE cafes ADD COLUMN study_review TEXT`);
}
if (!cafeCols.has('rain_ok')) {
  // "우천시 카페": directly connected to a subway station by underground passage
  // (admin-set, not crowd-sourced). Default off.
  db.exec(`ALTER TABLE cafes ADD COLUMN rain_ok INTEGER NOT NULL DEFAULT 0`);
}
// AI-generated English translations of user-facing text (shown when the UI is in English)
for (const col of ['name_en', 'address_en', 'study_review_en', 'view_note_en', 'review_summary_en']) {
  if (!cafeCols.has(col)) db.exec(`ALTER TABLE cafes ADD COLUMN ${col} TEXT`);
}

const userCols = new Set(db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name));
if (!userCols.has('password_hash')) {
  db.exec(`ALTER TABLE users ADD COLUMN password_hash TEXT`); // for provider='local' (id/pw) accounts
}
if (!userCols.has('is_admin')) {
  db.exec(`ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0`);
}

// per-photo uploader attribution for view-spot photos
const vpCols = new Set(db.prepare(`PRAGMA table_info(viewspot_photos)`).all().map((c) => c.name));
if (!vpCols.has('created_by')) {
  db.exec(`ALTER TABLE viewspot_photos ADD COLUMN created_by TEXT`);
}
// view-spots can be user-proposed (pending) awaiting admin approval
const vsCols = new Set(db.prepare(`PRAGMA table_info(viewspots)`).all().map((c) => c.name));
if (!vsCols.has('status')) {
  db.exec(`ALTER TABLE viewspots ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'`);
}
if (!vsCols.has('name_en')) db.exec(`ALTER TABLE viewspots ADD COLUMN name_en TEXT`);
// English translations of user text: story bodies + view-spot comments
const reviewCols2 = new Set(db.prepare(`PRAGMA table_info(reviews)`).all().map((c) => c.name));
if (!reviewCols2.has('body_en')) db.exec(`ALTER TABLE reviews ADD COLUMN body_en TEXT`);
const vcCols = new Set(db.prepare(`PRAGMA table_info(viewspot_comments)`).all().map((c) => c.name));
if (!vcCols.has('body_en')) db.exec(`ALTER TABLE viewspot_comments ADD COLUMN body_en TEXT`);

// daily unique-visitor tally (one bump per visitor session per day)
db.exec(`CREATE TABLE IF NOT EXISTS daily_visits (day TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)`);

// small key/value store for admin-set site settings (e.g. the global default score weights)
db.exec(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)`);

// Per-action analytics: one row per tracked event (page view, opening a cafe/view-spot,
// applying a filter, searching, liking, ...). session_id (the express-session id) tells
// apart distinct visitors; user_id links logged-in users. Query this to analyze traffic.
db.exec(`CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  day        TEXT NOT NULL,
  session_id TEXT,
  user_id    TEXT,
  type       TEXT NOT NULL,
  target     TEXT,
  label      TEXT,
  ip         TEXT,
  country    TEXT,
  ua         TEXT,
  is_bot     INTEGER NOT NULL DEFAULT 0,
  is_admin   INTEGER NOT NULL DEFAULT 0
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_events_day ON events(day)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_events_type ON events(type)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id)`);

// 따봉(likes) on view-spots — the count decides which survives when cards overlap
db.exec(`CREATE TABLE IF NOT EXISTS viewspot_likes (
  viewspot_id TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (viewspot_id, user_id)
)`);
// 따봉(likes) on cafes too — powers the "♥ 좋아요" filter
db.exec(`CREATE TABLE IF NOT EXISTS cafe_likes (
  cafe_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (cafe_id, user_id)
)`);

// --- safety net: timestamped DB backups (keep last 60) ---
// So no operation is ever irreversible: if data is lost, restore from data/backups/.
const backupsDir = path.join(DATA_DIR, 'backups');
const KEEP_BACKUPS = 60;
function backupNow() {
  try {
    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
    const rows = db.prepare('SELECT (SELECT COUNT(*) FROM cafes) + (SELECT COUNT(*) FROM users) + (SELECT COUNT(*) FROM viewspots) AS n').get().n;
    if (rows <= 0) return; // never overwrite history with an empty snapshot
    db.pragma('wal_checkpoint(TRUNCATE)'); // flush WAL into the main file first
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dest = path.join(backupsDir, `app-${stamp}.db`);
    if (!fs.existsSync(dest)) fs.copyFileSync(path.join(DATA_DIR, 'app.db'), dest);
    const files = fs.readdirSync(backupsDir).filter((f) => /^app-.*\.db$/.test(f)).sort();
    for (const f of files.slice(0, -KEEP_BACKUPS)) fs.unlinkSync(path.join(backupsDir, f));
  } catch (e) {
    console.error('DB backup skipped:', e.message);
  }
}
backupNow(); // on startup
// and periodically while the server runs; .unref() so short-lived scripts still exit
try {
  const timer = setInterval(backupNow, 5 * 60 * 1000);
  if (timer.unref) timer.unref();
} catch { /* setInterval unavailable */ }

// --- hard guard: make accidental bulk data loss structurally impossible ---
// ANY code path through this module — the server, a seed, or an ad-hoc
// `node -e "...DELETE..."` — is blocked from dropping tables or running a
// DELETE/UPDATE with no WHERE. Legitimate single-row ops (WHERE id=?) pass.
// Escape hatch, used only with deliberate intent: ALLOW_DESTRUCTIVE=1.
const DESTRUCTIVE = [
  { re: /\bdrop\s+table\b/i, why: 'DROP TABLE' },
  { re: /\bdelete\s+from\s+["`[]?\w+["`\]]?\s*(;|$)/i, why: 'DELETE without WHERE' },
  { re: /\bupdate\s+["`[]?\w+["`\]]?\s+set\b(?![\s\S]*\bwhere\b)/i, why: 'UPDATE without WHERE' },
  { re: /\btruncate\b/i, why: 'TRUNCATE' },
];
function assertSafe(sql) {
  if (process.env.ALLOW_DESTRUCTIVE === '1') return sql;
  const s = String(sql);
  for (const { re, why } of DESTRUCTIVE) {
    if (re.test(s)) {
      backupNow(); // snapshot first, then refuse
      throw new Error(
        `🛑 차단됨: 위험한 SQL (${why}). 이 DB는 보호되어 있어 통째로 지울 수 없습니다.\n` +
        `   정말 의도한 거라면 ALLOW_DESTRUCTIVE=1 을 명시적으로 설정하세요.\n   → ${s.trim().slice(0, 140)}`
      );
    }
  }
  return sql;
}
const _exec = db.exec.bind(db);
db.exec = (sql) => _exec(assertSafe(sql));
const _prepare = db.prepare.bind(db);
db.prepare = (sql) => _prepare(assertSafe(sql));

db.backupNow = backupNow; // exposed for manual/scripted snapshots

module.exports = db;
