'use strict';

// NON-DESTRUCTIVE seed. Ensures the admin account + example cafes EXIST.
// It NEVER deletes or overwrites existing data — user-added cafes/photos/votes
// are always preserved. Safe to run any number of times.
const crypto = require('crypto');
const db = require('./db');
const { hashPassword } = require('./auth');
const CAFES = require('./seed-data.json');

const tx = db.transaction(() => {
  // admin account (create once; never overwrite an existing one)
  let admin = db.prepare(`SELECT id FROM users WHERE provider='local' AND provider_id='sejun'`).get();
  if (!admin) {
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO users (id, provider, provider_id, name, password_hash, is_admin)
                VALUES (?,?,?,?,?,1)`).run(id, 'local', 'sejun', 'sejun', hashPassword('chongchong'));
    admin = { id };
  }

  // additional admins (create once; never overwrite)
  for (const uname of ['damhiya', 'YGH']) {
    if (!db.prepare(`SELECT 1 FROM users WHERE provider='local' AND provider_id=?`).get(uname)) {
      db.prepare(`INSERT INTO users (id, provider, provider_id, name, password_hash, is_admin)
                  VALUES (?,?,?,?,?,1)`).run(crypto.randomUUID(), 'local', uname, uname, hashPassword('chongchong'));
    }
  }

  const existsById = db.prepare('SELECT 1 FROM cafes WHERE kakao_place_id = ?');
  const existsByName = db.prepare('SELECT 1 FROM cafes WHERE name = ?');
  const insertCafe = db.prepare(`
    INSERT INTO cafes (id, name, address, lat, lng, photo_url, floors, open_time, close_time,
                       hours_json, size, naver_url, kakao_url, iced_americano_price, has_view, view_note,
                       outlets, review_summary, kakao_place_id, status, created_by)
    VALUES (@id,@name,@address,@lat,@lng,@photo_url,@floors,@open_time,@close_time,
            @hours_json,@size,@naver_url,@kakao_url,@iced_americano_price,@has_view,@view_note,@outlets,
            @review_summary,@kakao_place_id,'approved',@created_by)
  `);
  const insertCafePhoto = db.prepare('INSERT INTO cafe_photos (id, cafe_id, url, ord) VALUES (?,?,?,?)');

  let added = 0;
  for (const c of CAFES) {
    // skip if this example cafe already exists — never touch existing rows
    if ((c.kakao_place_id && existsById.get(c.kakao_place_id)) || existsByName.get(c.name)) continue;
    const id = crypto.randomUUID();
    insertCafe.run({
      id,
      name: c.name, address: c.address, lat: c.lat, lng: c.lng, photo_url: c.photo_url,
      floors: c.floors, open_time: c.open_time, close_time: c.close_time,
      hours_json: c.hours_json || null, size: c.size,
      naver_url: c.naver_url || '', kakao_url: c.kakao_url,
      iced_americano_price: c.iced_americano_price, has_view: c.has_view, view_note: c.view_note,
      outlets: c.outlets, review_summary: c.review_summary || null,
      kakao_place_id: c.kakao_place_id || null, created_by: admin.id,
    });
    const photos = (c.photos && c.photos.length) ? c.photos : [c.photo_url];
    photos.forEach((url, i) => insertCafePhoto.run(crypto.randomUUID(), id, url, i));
    added++;
  }
  return added;
});

const added = tx();
const total = db.prepare('SELECT COUNT(*) AS n FROM cafes').get().n;
console.log(`✅ seed: 예시 카페 ${added}곳 신규 추가 (기존 데이터 보존). 총 ${total}곳`);
