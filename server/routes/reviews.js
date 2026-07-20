'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireAuth, isAdmin } = require('../auth');
const { setCafeCover } = require('../cafePhotos');
const { processUploads } = require('../images');

const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', '..', 'uploads'),
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.jpg').toLowerCase().slice(0, 5);
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 30 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

const cafeExists = db.prepare('SELECT 1 FROM cafes WHERE id = ?');
const insertReview = db.prepare(`INSERT INTO reviews (id, cafe_id, user_id, body, photo_url) VALUES (@id,@cafe_id,@user_id,@body,@photo_url)`);
const insertPhoto = db.prepare(`INSERT INTO review_photos (id, review_id, cafe_id, url, ord) VALUES (?,?,?,?,?)`);
const getReview = db.prepare(`
  SELECT r.id, r.body, r.created_at, u.name AS user_name, u.avatar_url AS user_avatar
  FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.id = ?
`);
const photosOf = db.prepare(`SELECT url FROM review_photos WHERE review_id = ? ORDER BY ord`);

// POST /api/cafes/:id/reviews  — story: `body` + up to 10 `photos`
router.post('/:id/reviews', requireAuth, upload.array('photos', 30), async (req, res) => {
  const { id } = req.params;
  if (!cafeExists.get(id)) return res.status(404).json({ error: 'not found' });
  const body = (req.body?.body || '').trim();
  const files = req.files || [];
  if (!body && !files.length) return res.status(400).json({ error: '이야기나 사진을 올려주세요.' });
  await processUploads(files); // compress + thumbnails

  const reviewId = crypto.randomUUID();
  const tx = db.transaction(() => {
    insertReview.run({ id: reviewId, cafe_id: id, user_id: req.user.id, body, photo_url: files[0] ? `/uploads/${files[0].filename}` : null });
    files.forEach((f, i) => insertPhoto.run(crypto.randomUUID(), reviewId, id, `/uploads/${f.filename}`, i));
  });
  tx();

  // admin upload: the cover (first) photo becomes the cafe's representative image
  let coverSet = false;
  if (files.length && isAdmin(req.user)) {
    setCafeCover(id, `/uploads/${files[0].filename}`);
    coverSet = true;
  }

  const review = getReview.get(reviewId);
  review.photos = photosOf.all(reviewId).map((p) => p.url);
  review.coverSet = coverSet;
  res.status(201).json(review);
});

const getReviewRow = db.prepare('SELECT user_id, cafe_id, photo_url FROM reviews WHERE id = ?');
const upReviewBody = db.prepare('UPDATE reviews SET body = ?, photo_url = ? WHERE id = ?');
const delReviewPhotos = db.prepare('DELETE FROM review_photos WHERE review_id = ?');

// PATCH a story (author or admin): edit body + optionally rebuild its photos.
router.patch('/:id/reviews/:reviewId', requireAuth, upload.array('photos', 30), async (req, res) => {
  const r = getReviewRow.get(req.params.reviewId);
  const files = req.files || [];
  const cleanup = () => files.forEach((f) => fs.unlink(f.path, () => {}));
  if (!r || r.cafe_id !== req.params.id) { cleanup(); return res.status(404).json({ error: 'not found' }); }
  if (r.user_id !== req.user.id && !isAdmin(req.user)) { cleanup(); return res.status(403).json({ error: '수정 권한이 없습니다.' }); }
  await processUploads(files);
  const body = (req.body?.body || '').trim();

  let ordered = null; // null = don't touch photos; array = rebuild
  if ('photo_manifest' in (req.body || {})) {
    try {
      const manifest = JSON.parse(req.body.photo_manifest);
      let fi = 0; ordered = [];
      for (const tk of manifest) {
        if (tk === 'file') { if (files[fi]) ordered.push(`/uploads/${files[fi++].filename}`); }
        else if (typeof tk === 'string' && tk.startsWith('url:')) ordered.push(tk.slice(4));
      }
      ordered = ordered.filter(Boolean);
    } catch { ordered = null; }
  }
  if (!body && ordered !== null && !ordered.length) { cleanup(); return res.status(400).json({ error: '이야기나 사진을 남겨주세요.' }); }

  db.transaction(() => {
    upReviewBody.run(body, ordered && ordered.length ? ordered[0] : (r.photo_url || null), req.params.reviewId);
    if (ordered !== null) {
      delReviewPhotos.run(req.params.reviewId);
      ordered.forEach((url, i) => insertPhoto.run(crypto.randomUUID(), req.params.reviewId, req.params.id, url, i));
    }
  })();
  res.json({ ok: true });
});

// DELETE a story (and its photos, via FK cascade). Author or admin only.
const delReview = db.prepare('DELETE FROM reviews WHERE id = ?');
router.delete('/:id/reviews/:reviewId', requireAuth, (req, res) => {
  const r = getReviewRow.get(req.params.reviewId);
  if (!r || r.cafe_id !== req.params.id) return res.status(404).json({ error: 'not found' });
  if (r.user_id !== req.user.id && !isAdmin(req.user)) return res.status(403).json({ error: '삭제 권한이 없습니다.' });
  delReview.run(req.params.reviewId); // review_photos cascade via FK
  res.json({ ok: true });
});

module.exports = router;
