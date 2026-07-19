'use strict';

// Seeds REAL Seoul cafes (data pulled from Kakao into seed-data.json) plus a few
// demo users with votes & reviews. Real coords / photos / hours / prices / Kakao
// links — so the map isn't full of fake placeholders.
const crypto = require('crypto');
const db = require('./db');
const { hashPassword } = require('./auth');
const CAFES = require('./seed-data.json');

const tx = db.transaction(() => {
  db.exec('DELETE FROM reviews; DELETE FROM votes; DELETE FROM cafes; DELETE FROM users;');

  // admin account: username sejun / password chongchong
  db.prepare(`INSERT INTO users (id, provider, provider_id, name, password_hash, is_admin)
              VALUES (?,?,?,?,?,1)`)
    .run(crypto.randomUUID(), 'local', 'sejun', 'sejun', hashPassword('chongchong'));

  const demoUsers = ['카공러', '노트북요정', '아메리카노프로', '카페탐험가'].map((name) => {
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO users (id, provider, provider_id, name) VALUES (?,?,?,?)`)
      .run(id, 'dev', name.toLowerCase(), name);
    return { id, name };
  });

  const insertCafe = db.prepare(`
    INSERT INTO cafes (id, name, address, lat, lng, photo_url, floors, open_time, close_time,
                       size, naver_url, kakao_url, iced_americano_price, has_view, view_note,
                       outlets, review_summary, kakao_place_id, created_by)
    VALUES (@id,@name,@address,@lat,@lng,@photo_url,@floors,@open_time,@close_time,
            @size,@naver_url,@kakao_url,@iced_americano_price,@has_view,@view_note,@outlets,
            @review_summary,@kakao_place_id,@created_by)
  `);
  const insertVote = db.prepare(`INSERT INTO votes (cafe_id, user_id, category, score) VALUES (?,?,?,?)`);
  const insertReview = db.prepare(`INSERT INTO reviews (id, cafe_id, user_id, body, photo_url) VALUES (?,?,?,?,?)`);

  // deterministic pseudo-random so reruns are stable
  let s = 12345;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  const reviewBodies = [
    '콘센트 자리 많고 오래 앉아 있어도 눈치 안 보여요.',
    '조용해서 집중 잘 됨. 커피도 산미 적당.',
    '창가 자리에서 노트북 작업하기 좋아요.',
    '주말엔 좀 붐비지만 평일 낮엔 카공 천국.',
    '화장실 깨끗하고 와이파이 빵빵해요.',
    '2층이 넓어서 자리 잡기 좋아요.',
  ];

  for (const c of CAFES) {
    const id = crypto.randomUUID();
    insertCafe.run({
      id,
      name: c.name, address: c.address, lat: c.lat, lng: c.lng, photo_url: c.photo_url,
      floors: c.floors, open_time: c.open_time, close_time: c.close_time, size: c.size,
      naver_url: c.naver_url || '', kakao_url: c.kakao_url,
      iced_americano_price: c.iced_americano_price, has_view: c.has_view, view_note: c.view_note,
      outlets: c.outlets, review_summary: c.review_summary || null,
      kakao_place_id: c.kakao_place_id || null, created_by: pick(demoUsers).id,
    });

    for (const cat of ['coffee', 'quiet', 'restroom']) {
      const voters = demoUsers.slice(0, 2 + Math.floor(rnd() * 3));
      for (const u of voters) insertVote.run(id, u.id, cat, 2 + Math.floor(rnd() * 4));
    }
    const nrev = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < nrev; i++) insertReview.run(crypto.randomUUID(), id, pick(demoUsers).id, pick(reviewBodies), null);
  }
});

tx();
const n = db.prepare('SELECT COUNT(*) AS n FROM cafes').get().n;
console.log(`✅ seeded ${n} real cafes (+ demo users, votes, reviews)`);
