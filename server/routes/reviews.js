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
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

const cafeExists = db.prepare('SELECT 1 FROM cafes WHERE id = ?');
const insertReview = db.prepare(`
  INSERT INTO reviews (id, cafe_id, user_id, body, photo_url)
  VALUES (@id, @cafe_id, @user_id, @body, @photo_url)
`);
const getReview = db.prepare(`
  SELECT r.id, r.body, r.photo_url, r.created_at, u.name AS user_name, u.avatar_url AS user_avatar
  FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.id = ?
`);

// POST /api/cafes/:id/reviews  (multipart, optional `photo`, field `body`)
router.post('/:id/reviews', requireAuth, upload.single('photo'), (req, res) => {
  const { id } = req.params;
  if (!cafeExists.get(id)) return res.status(404).json({ error: 'not found' });
  const body = (req.body?.body || '').trim();
  const photoUrl = req.file ? `/uploads/${req.file.filename}` : null;
  if (!body && !photoUrl) return res.status(400).json({ error: '후기 내용이나 사진이 필요합니다.' });

  const reviewId = crypto.randomUUID();
  insertReview.run({ id: reviewId, cafe_id: id, user_id: req.user.id, body, photo_url: photoUrl });
  res.status(201).json(getReview.get(reviewId));
});

module.exports = router;
