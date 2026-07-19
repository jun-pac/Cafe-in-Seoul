'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { decorate } = require('../cafeModel');
const { requireAuth, requireAdmin, isAdmin } = require('../auth');
const { moderate } = require('../moderation');

const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', '..', 'uploads'),
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.jpg').toLowerCase().slice(0, 5);
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

const listStmt = db.prepare('SELECT * FROM cafes');
const getStmt = db.prepare('SELECT * FROM cafes WHERE id = ?');
const reviewsStmt = db.prepare(`
  SELECT r.id, r.body, r.photo_url, r.created_at, u.name AS user_name, u.avatar_url AS user_avatar
  FROM reviews r JOIN users u ON u.id = r.user_id
  WHERE r.cafe_id = ? ORDER BY r.created_at DESC
`);
const reviewPhotosStmt = db.prepare('SELECT review_id, url FROM review_photos WHERE cafe_id = ? ORDER BY ord');
const galleryStmt = db.prepare('SELECT url FROM review_photos WHERE cafe_id = ? ORDER BY rowid DESC');
const cafePhotosStmt = db.prepare('SELECT url FROM cafe_photos WHERE cafe_id = ? ORDER BY ord');
const insertCafePhoto = db.prepare('INSERT INTO cafe_photos (id, cafe_id, url, ord) VALUES (?,?,?,?)');
const myVotesStmt = db.prepare('SELECT category, score FROM votes WHERE cafe_id = ? AND user_id = ?');

const insertCafe = db.prepare(`
  INSERT INTO cafes (id, name, address, lat, lng, photo_url, floors, open_time, close_time,
                     size, naver_url, kakao_url, iced_americano_price, has_view, view_note,
                     outlets, review_summary, kakao_place_id, status, moderation_reason, created_by)
  VALUES (@id, @name, @address, @lat, @lng, @photo_url, @floors, @open_time, @close_time,
          @size, @naver_url, @kakao_url, @iced_americano_price, @has_view, @view_note,
          @outlets, @review_summary, @kakao_place_id, @status, @moderation_reason, @created_by)
`);

// GET /api/cafes — map list. Everyone sees approved cafes; a logged-in user also
// sees their OWN pending drafts; admins see all pending too.
router.get('/', (req, res) => {
  const uid = req.user?.id;
  const admin = isAdmin(req.user);
  const cafes = listStmt.all()
    .filter((c) => c.status === 'approved' || admin || (uid && c.created_by === uid))
    .map(decorate);
  cafes.sort((a, b) => b.score - a.score);
  res.json(cafes);
});

// GET /api/cafes/:id — full detail incl. reviews + this user's votes
router.get('/:id', (req, res) => {
  const cafe = getStmt.get(req.params.id);
  if (!cafe) return res.status(404).json({ error: 'not found' });
  const detail = decorate(cafe);
  detail.reviews = reviewsStmt.all(cafe.id);
  const photosByReview = {};
  for (const p of reviewPhotosStmt.all(cafe.id)) (photosByReview[p.review_id] ||= []).push(p.url);
  for (const r of detail.reviews) r.photos = photosByReview[r.id] || (r.photo_url ? [r.photo_url] : []);
  // carousel gallery: cafe photos (ordered, representative first) + story photos
  const cp = cafePhotosStmt.all(cafe.id).map((p) => p.url);
  const base = cp.length ? cp : (detail.photo_url ? [detail.photo_url] : []);
  detail.gallery = [...base, ...galleryStmt.all(cafe.id).map((p) => p.url)].filter(Boolean);
  detail.myVotes = {};
  if (req.user) {
    for (const v of myVotesStmt.all(cafe.id, req.user.id)) detail.myVotes[v.category] = v.score;
  }
  res.json(detail);
});

const SIZES = new Set(['small', 'medium', 'large']);
const OUTLETS = new Set(['many', 'some', 'few', 'none']);
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

function validationError(body, hasPhoto) {
  const missing = [];
  const need = (k) => (body[k] === undefined || body[k] === null || String(body[k]).trim() === '') && missing.push(k);
  // naver_url is optional (not everyone has a real Naver place link); kakao_url required.
  ['name', 'lat', 'lng', 'floors', 'open_time', 'close_time', 'size',
   'kakao_url', 'iced_americano_price', 'outlets'].forEach(need);
  if (!hasPhoto) missing.push('photo');
  if (body.has_view === undefined || body.has_view === null || body.has_view === '') missing.push('has_view');
  if (missing.length) return `필수 항목 누락: ${missing.join(', ')}`;

  if (!Number.isFinite(+body.lat) || !Number.isFinite(+body.lng)) return '좌표(lat/lng)가 올바르지 않습니다.';
  if (!Number.isInteger(+body.floors) || +body.floors < 1) return '층수(floors)가 올바르지 않습니다.';
  if (!TIME_RE.test(body.open_time) || !TIME_RE.test(body.close_time)) return '영업시간 형식은 HH:MM 이어야 합니다.';
  if (!SIZES.has(body.size)) return '면적(size)은 small/medium/large 중 하나여야 합니다.';
  if (!OUTLETS.has(body.outlets)) return '콘센트(outlets)는 many/some/few/none 중 하나여야 합니다.';
  if (!Number.isInteger(+body.iced_americano_price) || +body.iced_americano_price < 0) return '아이스 아메리카노 가격이 올바르지 않습니다.';
  return null;
}

// POST /api/cafes — register a cafe (auth required). multipart with `photos` (many)
// + `photo_manifest` (JSON array of 'file' | 'url:<url>') defining order; the first
// photo is the representative. Admins auto-publish; others go through AI moderation.
router.post('/', requireAuth, upload.array('photos', 10), async (req, res, next) => {
  const b = req.body || {};
  const files = req.files || [];
  const cleanup = () => files.forEach((f) => fs.unlink(f.path, () => {}));

  let manifest = [];
  try { manifest = JSON.parse(b.photo_manifest || '[]'); } catch { manifest = []; }
  let fi = 0;
  let ordered = [];
  if (manifest.length) {
    for (const t of manifest) {
      if (t === 'file') { if (files[fi]) ordered.push(`/uploads/${files[fi++].filename}`); }
      else if (typeof t === 'string' && t.startsWith('url:')) ordered.push(t.slice(4));
    }
  } else if (files.length) {
    ordered = files.map((f) => `/uploads/${f.filename}`);
  } else if ((b.photo_url || '').trim()) {
    ordered = [b.photo_url.trim()];
  }
  ordered = ordered.filter(Boolean);

  const err = validationError(b, ordered.length > 0);
  if (err) { cleanup(); return res.status(400).json({ error: err }); }

  const toBool = (v) => (v === true || v === 'true' || v === '1' || v === 1 ? 1 : 0);
  const cafe = {
    id: crypto.randomUUID(),
    name: b.name.trim(),
    address: (b.address || '').trim() || null,
    lat: +b.lat,
    lng: +b.lng,
    photo_url: ordered[0],
    floors: +b.floors,
    open_time: b.open_time,
    close_time: b.close_time,
    size: b.size,
    naver_url: (b.naver_url || '').trim(),
    kakao_url: b.kakao_url.trim(),
    iced_americano_price: +b.iced_americano_price,
    has_view: toBool(b.has_view),
    view_note: (b.view_note || '').trim() || null,
    outlets: b.outlets,
    review_summary: (b.review_summary || '').trim() || null,
    kakao_place_id: (b.kakao_place_id || '').trim() || null,
    created_by: req.user.id,
  };

  try {
    const verdict = await moderate(cafe, { isAdmin: isAdmin(req.user) });
    db.transaction(() => {
      insertCafe.run({ ...cafe, status: verdict.status, moderation_reason: verdict.reason });
      ordered.forEach((url, i) => insertCafePhoto.run(crypto.randomUUID(), cafe.id, url, i));
    })();
    res.status(201).json({ ...decorate(getStmt.get(cafe.id)), moderation: verdict });
  } catch (e) {
    cleanup();
    next(e);
  }
});

// PATCH /api/cafes/:id — admin edits (curate the discrete/core fields).
const EDITABLE = {
  name: 'text', address: 'text', floors: 'int', size: 'size', outlets: 'outlets',
  has_view: 'bool', view_note: 'text', open_time: 'time', close_time: 'time',
  iced_americano_price: 'int', naver_url: 'text', kakao_url: 'text',
  photo_url: 'text', review_summary: 'text',
};
router.patch('/:id', requireAdmin, express.json(), (req, res) => {
  const cafe = getStmt.get(req.params.id);
  if (!cafe) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  const sets = [];
  const params = { id: req.params.id };
  for (const [k, type] of Object.entries(EDITABLE)) {
    if (!(k in b)) continue;
    let v = b[k];
    if (type === 'int') { v = Number(v); if (!Number.isInteger(v) || v < 0) return res.status(400).json({ error: `${k} 값이 올바르지 않습니다.` }); }
    else if (type === 'bool') { v = (v === true || v === 'true' || v === 1 || v === '1') ? 1 : 0; }
    else if (type === 'time') { if (!TIME_RE.test(v)) return res.status(400).json({ error: '시간 형식은 HH:MM' }); }
    else if (type === 'size') { if (!SIZES.has(v)) return res.status(400).json({ error: 'size 값 오류' }); }
    else if (type === 'outlets') { if (!OUTLETS.has(v)) return res.status(400).json({ error: 'outlets 값 오류' }); }
    else { v = (v == null ? '' : String(v).trim()) || null; if (k === 'name' && !v) return res.status(400).json({ error: '이름은 비울 수 없습니다.' }); }
    sets.push(`${k} = @${k}`);
    params[k] = v;
  }
  if (!sets.length) return res.status(400).json({ error: '변경할 항목이 없습니다.' });
  db.prepare(`UPDATE cafes SET ${sets.join(', ')} WHERE id = @id`).run(params);
  res.json(decorate(getStmt.get(req.params.id)));
});

module.exports = router;
