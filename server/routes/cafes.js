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
const { setCafeCover } = require('../cafePhotos');
const { processUploads } = require('../images');
const { sendAdminAlert } = require('../mailer');

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
  SELECT r.id, r.user_id, r.body, r.photo_url, r.created_at, u.name AS user_name, u.avatar_url AS user_avatar
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
                     hours_json, size, naver_url, kakao_url, iced_americano_price, has_view, view_note,
                     outlets, review_summary, study_review, rain_ok, kakao_place_id, status, moderation_reason, created_by)
  VALUES (@id, @name, @address, @lat, @lng, @photo_url, @floors, @open_time, @close_time,
          @hours_json, @size, @naver_url, @kakao_url, @iced_americano_price, @has_view, @view_note,
          @outlets, @review_summary, @study_review, @rain_ok, @kakao_place_id, @status, @moderation_reason, @created_by)
`);

// GET /api/cafes — map list. Everyone sees approved cafes; a logged-in user also
// sees their OWN pending drafts; admins see all pending too.
router.get('/', (req, res) => {
  const uid = req.user?.id;
  const admin = isAdmin(req.user);
  const cafes = listStmt.all()
    .filter((c) => c.status !== 'rejected') // soft-deleted cafes never appear on the map
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
  // THE representative photo (photo_url = the cover) is ALWAYS first, so the map card,
  // the detail hero, and the edit modal all lead with the SAME photo — never disagree.
  const cover = detail.photo_url ? [detail.photo_url] : [];
  const imported = cafePhotosStmt.all(cafe.id).map((p) => p.url);   // cafe_photos (cover + imported/Kakao)
  const stories = galleryStmt.all(cafe.id).map((p) => p.url);       // review_photos (story uploads)
  const own = [...new Set([...cover, ...imported].filter(Boolean))]; // the cafe's OWN photos, cover first
  // Story-uploaded photos the cafe doesn't own. They belong to their story: shown read-only
  // in the edit modal, NEVER deletable there (deleting a story photo happens in the story,
  // so it can't be orphaned). They still appear in the viewing gallery, after the own photos.
  const storyOnly = [...new Set(stories.filter(Boolean))].filter((u) => !own.includes(u));
  detail.gallery = [...own, ...storyOnly];  // cover-first → card == hero == gallery[0]
  detail.photos = detail.gallery;
  detail.cafePhotos = own;         // EDITABLE in the edit modal (reorder / delete / add). First = cover.
  detail.storyPhotos = storyOnly;  // READ-ONLY in the edit modal.
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
  ['name', 'lat', 'lng', 'floors', 'open_time', 'close_time', 'size',
   'iced_americano_price', 'outlets', 'study_review'].forEach(need);
  if (!hasPhoto) missing.push('photo');
  if (body.has_view === undefined || body.has_view === null || body.has_view === '') missing.push('has_view');
  if (missing.length) return `필수 항목 누락: ${missing.join(', ')}`;
  if ((body.study_review || '').trim().length < 15) return '카공 총평을 조금 더 자세히 적어주세요 (감시받지 않는 기분 등).';

  // at least one map link (Kakao OR Naver) — not both required
  if (!(body.kakao_url || '').trim() && !(body.naver_url || '').trim()) {
    return '카카오 또는 네이버 지도 링크 중 하나는 필요합니다.';
  }

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
router.post('/', requireAuth, upload.array('photos', 30), async (req, res, next) => {
  const b = req.body || {};
  const files = req.files || [];
  const cleanup = () => files.forEach((f) => fs.unlink(f.path, () => {}));
  await processUploads(files); // compress + generate thumbnails before we build URLs

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
    hours_json: (b.hours_json || '').trim() || null,
    size: b.size,
    naver_url: (b.naver_url || '').trim(),
    kakao_url: (b.kakao_url || '').trim(),
    iced_americano_price: +b.iced_americano_price,
    has_view: toBool(b.has_view),
    view_note: (b.view_note || '').trim() || null,
    outlets: b.outlets,
    review_summary: (b.review_summary || '').trim() || null,
    study_review: (b.study_review || '').trim() || null,
    rain_ok: toBool(b.rain_ok),
    kakao_place_id: (b.kakao_place_id || '').trim() || null,
    created_by: req.user.id,
  };

  // admins publish immediately; everyone else PROPOSES (pending, hidden until approved)
  const admin = isAdmin(req.user);
  const status = admin ? 'approved' : 'pending';
  try {
    db.transaction(() => {
      insertCafe.run({ ...cafe, status, moderation_reason: admin ? null : '사용자 제안 (승인 대기)' });
      ordered.forEach((url, i) => insertCafePhoto.run(crypto.randomUUID(), cafe.id, url, i));
    })();
    if (!admin) {
      sendAdminAlert(
        `[Cafe in Seoul] 새 카페 제안: ${cafe.name}`,
        `${req.user.name || req.user.id} 님이 카페를 제안했습니다.\n\n이름: ${cafe.name}\n주소: ${cafe.address || '-'}\n카카오: ${cafe.kakao_url || '-'}\n네이버: ${cafe.naver_url || '-'}\n\n관리자로 로그인해 심사 대기열에서 승인/거절하세요:\n${process.env.BASE_URL || ''}`
      ).catch(() => {});
    }
    res.status(201).json({ ...decorate(getStmt.get(cafe.id)), pending: !admin });
  } catch (e) {
    cleanup();
    next(e);
  }
});

// PATCH /api/cafes/:id — admin edits. multipart: editable fields + optional
// `photo_manifest` (['file'|'url:...']) + `photos` files to rebuild cafe photos.
const EDITABLE = {
  name: 'text', address: 'text', floors: 'int', size: 'size', outlets: 'outlets',
  has_view: 'bool', view_note: 'text', open_time: 'time', close_time: 'time',
  hours_json: 'hours', rain_ok: 'bool',
  iced_americano_price: 'int', naver_url: 'link', kakao_url: 'link', review_summary: 'text', study_review: 'text',
};
const delCafePhotos = db.prepare('DELETE FROM cafe_photos WHERE cafe_id = ?');
router.patch('/:id', requireAdmin, upload.array('photos', 30), async (req, res) => {
  const cafe = getStmt.get(req.params.id);
  const files = req.files || [];
  const cleanup = () => files.forEach((f) => fs.unlink(f.path, () => {}));
  if (!cafe) { cleanup(); return res.status(404).json({ error: 'not found' }); }
  await processUploads(files); // compress + thumbnails
  const b = req.body || {};
  const sets = [];
  const params = { id: req.params.id };
  const bail = (m) => { cleanup(); res.status(400).json({ error: m }); return true; };
  for (const [k, type] of Object.entries(EDITABLE)) {
    if (!(k in b)) continue;
    let v = b[k];
    if (type === 'int') { v = Number(v); if (!Number.isInteger(v) || v < 0) { if (bail(`${k} 값이 올바르지 않습니다.`)) return; } }
    else if (type === 'bool') { v = (v === true || v === 'true' || v === 1 || v === '1') ? 1 : 0; }
    else if (type === 'time') { if (!TIME_RE.test(v)) { if (bail('시간 형식은 HH:MM')) return; } }
    else if (type === 'size') { if (!SIZES.has(v)) { if (bail('size 값 오류')) return; } }
    else if (type === 'outlets') { if (!OUTLETS.has(v)) { if (bail('outlets 값 오류')) return; } }
    else if (type === 'link') { v = (v == null ? '' : String(v).trim()); } // NOT NULL column → store '' not null
    else if (type === 'hours') {
      // per-weekday schedule: JSON array of 7 [{dow,open,close}|{dow,closed:true}], or empty → null
      const raw = (v == null ? '' : String(v)).trim();
      if (!raw) { v = null; }
      else {
        let arr; try { arr = JSON.parse(raw); } catch { arr = null; }
        if (!Array.isArray(arr) || arr.length !== 7) { if (bail('영업시간(요일별) 형식이 올바르지 않습니다.')) return; }
        for (const e of arr) {
          if (!e || e.closed) continue;
          if (!TIME_RE.test(e.open || '') || !TIME_RE.test(e.close || '')) { if (bail('영업시간 형식은 HH:MM 이어야 합니다.')) return; }
        }
        v = JSON.stringify(arr);
      }
    }
    else { v = (v == null ? '' : String(v).trim()) || null; if (k === 'name' && !v) { if (bail('이름은 비울 수 없습니다.')) return; } }
    sets.push(`${k} = @${k}`);
    params[k] = v;
  }

  // rebuild cafe photos from manifest (if provided)
  let ordered = null;
  if (b.photo_manifest) {
    try {
      const manifest = JSON.parse(b.photo_manifest);
      let fi = 0; ordered = [];
      for (const t of manifest) {
        if (t === 'file') { if (files[fi]) ordered.push(`/uploads/${files[fi++].filename}`); }
        else if (typeof t === 'string' && t.startsWith('url:')) ordered.push(t.slice(4));
      }
      ordered = ordered.filter(Boolean);
    } catch { ordered = null; }
    if (ordered && !ordered.length) { if (bail('사진을 한 장 이상 남겨주세요.')) return; }
  }
  if (ordered && ordered.length) { sets.push('photo_url = @photo_url'); params.photo_url = ordered[0]; }

  if (!sets.length && !ordered) { cleanup(); return res.status(400).json({ error: '변경할 항목이 없습니다.' }); }

  db.transaction(() => {
    if (sets.length) db.prepare(`UPDATE cafes SET ${sets.join(', ')} WHERE id = @id`).run(params);
    if (ordered && ordered.length) {
      delCafePhotos.run(req.params.id);
      ordered.forEach((url, i) => insertCafePhoto.run(crypto.randomUUID(), req.params.id, url, i));
    }
  })();
  res.json(decorate(getStmt.get(req.params.id)));
});

// POST /api/cafes/:id/cover  { url } — admin sets any of the cafe's photos as the representative
router.post('/:id/cover', requireAdmin, express.json(), (req, res) => {
  const cafe = getStmt.get(req.params.id);
  if (!cafe) return res.status(404).json({ error: 'not found' });
  const url = (req.body?.url || '').trim();
  if (!url) return res.status(400).json({ error: 'url이 필요합니다.' });
  setCafeCover(req.params.id, url);
  res.json(decorate(getStmt.get(req.params.id)));
});

module.exports = router;
