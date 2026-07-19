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
  photo_url  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (cafe_id) REFERENCES cafes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_votes_cafe    ON votes(cafe_id);
CREATE INDEX IF NOT EXISTS idx_reviews_cafe  ON reviews(cafe_id);
`);

module.exports = db;
