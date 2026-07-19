'use strict';

// Seeds REAL Seoul cafes (data in seed-data.json) + the admin account.
// No fake votes/reviews — collective evaluation and stories start empty and
// fill in from real users.
const crypto = require('crypto');
const db = require('./db');
const { hashPassword } = require('./auth');
const CAFES = require('./seed-data.json');

const tx = db.transaction(() => {
  db.exec('DELETE FROM messages; DELETE FROM reviews; DELETE FROM votes; DELETE FROM cafes; DELETE FROM users;');

  // admin account: username sejun / password chongchong
  const adminId = crypto.randomUUID();
  db.prepare(`INSERT INTO users (id, provider, provider_id, name, password_hash, is_admin)
              VALUES (?,?,?,?,?,1)`)
    .run(adminId, 'local', 'sejun', 'sejun', hashPassword('chongchong'));

  const insertCafe = db.prepare(`
    INSERT INTO cafes (id, name, address, lat, lng, photo_url, floors, open_time, close_time,
                       size, naver_url, kakao_url, iced_americano_price, has_view, view_note,
                       outlets, review_summary, kakao_place_id, status, created_by)
    VALUES (@id,@name,@address,@lat,@lng,@photo_url,@floors,@open_time,@close_time,
            @size,@naver_url,@kakao_url,@iced_americano_price,@has_view,@view_note,@outlets,
            @review_summary,@kakao_place_id,'approved',@created_by)
  `);

  for (const c of CAFES) {
    insertCafe.run({
      id: crypto.randomUUID(),
      name: c.name, address: c.address, lat: c.lat, lng: c.lng, photo_url: c.photo_url,
      floors: c.floors, open_time: c.open_time, close_time: c.close_time, size: c.size,
      naver_url: c.naver_url || '', kakao_url: c.kakao_url,
      iced_americano_price: c.iced_americano_price, has_view: c.has_view, view_note: c.view_note,
      outlets: c.outlets, review_summary: c.review_summary || null,
      kakao_place_id: c.kakao_place_id || null, created_by: adminId,
    });
  }
});

tx();
const n = db.prepare('SELECT COUNT(*) AS n FROM cafes').get().n;
console.log(`✅ seeded ${n} real cafes + admin(sejun) — votes/stories start empty`);
