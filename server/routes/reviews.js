'use strict';

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', '..', 'uploads'),
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.jpg').toLowerCase().slice(0, 5);
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 10 },
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
router.post('/:id/reviews', requireAuth, upload.array('photos', 10), (req, res) => {
  const { id } = req.params;
  if (!cafeExists.get(id)) return res.status(404).json({ error: 'not found' });
  const body = (req.body?.body || '').trim();
  const files = req.files || [];
  if (!body && !files.length) return res.status(400).json({ error: '이야기나 사진을 올려주세요.' });

  const reviewId = crypto.randomUUID();
  const tx = db.transaction(() => {
    insertReview.run({ id: reviewId, cafe_id: id, user_id: req.user.id, body, photo_url: files[0] ? `/uploads/${files[0].filename}` : null });
    files.forEach((f, i) => insertPhoto.run(crypto.randomUUID(), reviewId, id, `/uploads/${f.filename}`, i));
  });
  tx();

  const review = getReview.get(reviewId);
  review.photos = photosOf.all(reviewId).map((p) => p.url);
  res.status(201).json(review);
});

module.exports = router;
