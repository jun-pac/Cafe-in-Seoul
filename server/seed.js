'use strict';

// Seeds example cafes + a couple of demo users with votes & reviews.
// Idempotent-ish: clears cafes/users/votes/reviews and re-inserts.
const crypto = require('crypto');
const db = require('./db');

const photo = (seed) => `https://picsum.photos/seed/${seed}/800/600`;

// name, area coords, and the 7 required discrete fields
const CAFES = [
  {
    name: '성수 로스터리 라운지', address: '서울 성동구 성수동2가', lat: 37.5447, lng: 127.0557,
    floors: 3, open_time: '09:00', close_time: '23:00', size: 'large',
    iced_americano_price: 4500, has_view: 1, view_note: '루프탑에서 서울숲 방향 뷰', outlets: 'many',
    seed: 'cafe-seongsu-1',
  },
  {
    name: '연남 책방 카페', address: '서울 마포구 연남동', lat: 37.5631, lng: 126.9254,
    floors: 2, open_time: '10:00', close_time: '22:00', size: 'medium',
    iced_americano_price: 4000, has_view: 0, view_note: null, outlets: 'many',
    seed: 'cafe-yeonnam-1',
  },
  {
    name: '망원 한강뷰 브루잉', address: '서울 마포구 망원동', lat: 37.5554, lng: 126.9010,
    floors: 2, open_time: '08:00', close_time: '24:00', size: 'medium',
    iced_americano_price: 5000, has_view: 1, view_note: '2층 창가 한강 방향', outlets: 'some',
    seed: 'cafe-mangwon-1',
  },
  {
    name: '을지로 골목 커피', address: '서울 중구 을지로3가', lat: 37.5662, lng: 126.9913,
    floors: 1, open_time: '11:00', close_time: '21:00', size: 'small',
    iced_americano_price: 3500, has_view: 0, view_note: null, outlets: 'few',
    seed: 'cafe-euljiro-1',
  },
  {
    name: '한남 뷰 테라스', address: '서울 용산구 한남동', lat: 37.5343, lng: 127.0018,
    floors: 4, open_time: '09:30', close_time: '22:30', size: 'large',
    iced_americano_price: 6000, has_view: 1, view_note: '테라스에서 남산 뷰', outlets: 'many',
    seed: 'cafe-hannam-1',
  },
  {
    name: '홍대 24시 스터디 카페', address: '서울 마포구 서교동', lat: 37.5561, lng: 126.9235,
    floors: 3, open_time: '00:00', close_time: '24:00', size: 'large',
    iced_americano_price: 3800, has_view: 0, view_note: null, outlets: 'many',
    seed: 'cafe-hongdae-1',
  },
  {
    name: '삼청동 한옥 카페', address: '서울 종로구 삼청동', lat: 37.5828, lng: 126.9816,
    floors: 2, open_time: '10:00', close_time: '20:00', size: 'medium',
    iced_americano_price: 5500, has_view: 1, view_note: '한옥 마당 뷰', outlets: 'few',
    seed: 'cafe-samcheong-1',
  },
  {
    name: '강남 대형 프랜차이즈 리저브', address: '서울 강남구 역삼동', lat: 37.4995, lng: 127.0312,
    floors: 3, open_time: '07:00', close_time: '23:00', size: 'large',
    iced_americano_price: 4900, has_view: 0, view_note: null, outlets: 'many',
    seed: 'cafe-gangnam-1',
  },
  {
    name: '서촌 조용한 다락', address: '서울 종로구 통인동', lat: 37.5793, lng: 126.9698,
    floors: 2, open_time: '11:00', close_time: '21:30', size: 'small',
    iced_americano_price: 4200, has_view: 0, view_note: null, outlets: 'some',
    seed: 'cafe-seochon-1',
  },
  {
    name: '합정 창가 원목 카페', address: '서울 마포구 합정동', lat: 37.5492, lng: 126.9139,
    floors: 2, open_time: '09:00', close_time: '22:00', size: 'medium',
    iced_americano_price: 4300, has_view: 1, view_note: '큰 창 거리 뷰', outlets: 'some',
    seed: 'cafe-hapjeong-1',
  },
  {
    name: '이태원 루프탑 라운지', address: '서울 용산구 이태원동', lat: 37.5346, lng: 126.9944,
    floors: 4, open_time: '10:00', close_time: '24:00', size: 'large',
    iced_americano_price: 6500, has_view: 1, view_note: '루프탑 시티뷰', outlets: 'few',
    seed: 'cafe-itaewon-1',
  },
  {
    name: '여의도 오피스 카페', address: '서울 영등포구 여의도동', lat: 37.5216, lng: 126.9248,
    floors: 1, open_time: '07:30', close_time: '20:00', size: 'medium',
    iced_americano_price: 4100, has_view: 0, view_note: null, outlets: 'many',
    seed: 'cafe-yeouido-1',
  },
  {
    name: '북촌 언덕 뷰 카페', address: '서울 종로구 계동', lat: 37.5817, lng: 126.9852,
    floors: 3, open_time: '10:00', close_time: '22:00', size: 'medium',
    iced_americano_price: 5200, has_view: 1, view_note: '언덕 위 시내 전경', outlets: 'some',
    seed: 'cafe-bukchon-1',
  },
];

function naver(name) { return `https://map.naver.com/v5/search/${encodeURIComponent(name)}`; }
function kakao(name) { return `https://map.kakao.com/?q=${encodeURIComponent(name)}`; }

const tx = db.transaction(() => {
  db.exec('DELETE FROM reviews; DELETE FROM votes; DELETE FROM cafes; DELETE FROM users;');

  // demo users (dev provider) so votes/reviews have authors
  const demoUsers = ['카공러', '노트북요정', '아메리카노프로', '카페탐험가'].map((name) => {
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO users (id, provider, provider_id, name) VALUES (?,?,?,?)`)
      .run(id, 'dev', name.toLowerCase(), name);
    return { id, name };
  });

  const insertCafe = db.prepare(`
    INSERT INTO cafes (id, name, address, lat, lng, photo_url, floors, open_time, close_time,
                       size, naver_url, kakao_url, iced_americano_price, has_view, view_note,
                       outlets, created_by)
    VALUES (@id,@name,@address,@lat,@lng,@photo_url,@floors,@open_time,@close_time,
            @size,@naver_url,@kakao_url,@iced_americano_price,@has_view,@view_note,@outlets,@created_by)
  `);
  const insertVote = db.prepare(`
    INSERT INTO votes (cafe_id, user_id, category, score) VALUES (?,?,?,?)
  `);
  const insertReview = db.prepare(`
    INSERT INTO reviews (id, cafe_id, user_id, body, photo_url) VALUES (?,?,?,?,?)
  `);

  // deterministic pseudo-random so reruns are stable
  let s = 12345;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  const reviewBodies = [
    '콘센트 자리 많고 오래 앉아 있어도 눈치 안 보여요.',
    '조용해서 집중 잘 됨. 커피도 산미 적당.',
    '창가 자리 뷰가 예술입니다. 노트북 작업 최고.',
    '주말엔 좀 붐비지만 평일 낮엔 카공 천국.',
    '화장실 깨끗하고 와이파이 빵빵해요.',
    '아아 가성비 좋고 2층이 넓어서 좋아요.',
  ];

  for (const c of CAFES) {
    const id = crypto.randomUUID();
    insertCafe.run({
      id,
      name: c.name, address: c.address, lat: c.lat, lng: c.lng,
      photo_url: photo(c.seed),
      floors: c.floors, open_time: c.open_time, close_time: c.close_time, size: c.size,
      naver_url: naver(c.name), kakao_url: kakao(c.name),
      iced_americano_price: c.iced_americano_price, has_view: c.has_view, view_note: c.view_note,
      outlets: c.outlets, created_by: pick(demoUsers).id,
    });

    // seed 2-4 users' votes per category
    for (const cat of ['coffee', 'quiet', 'restroom']) {
      const voters = demoUsers.slice(0, 2 + Math.floor(rnd() * 3));
      for (const u of voters) {
        insertVote.run(id, u.id, cat, 2 + Math.floor(rnd() * 4)); // 2..5
      }
    }

    // 1-2 reviews
    const nrev = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < nrev; i++) {
      const u = pick(demoUsers);
      insertReview.run(crypto.randomUUID(), id, u.id, pick(reviewBodies), null);
    }
  }
});

tx();

const n = db.prepare('SELECT COUNT(*) AS n FROM cafes').get().n;
console.log(`✅ seeded ${n} cafes (+ demo users, votes, reviews)`);
