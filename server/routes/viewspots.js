'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireAuth, isAdmin } = require('../auth');

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

const listStmt = db.prepare('SELECT id, name, lat, lng, photo_url FROM viewspots');
const getStmt = db.prepare('SELECT * FROM viewspots WHERE id = ?');
const photosStmt = db.prepare('SELECT url FROM viewspot_photos WHERE viewspot_id = ? ORDER BY ord');
const insertSpot = db.prepare(`INSERT INTO viewspots (id, name, lat, lng, photo_url, created_by) VALUES (@id,@name,@lat,@lng,@photo_url,@created_by)`);
const insertPhoto = db.prepare('INSERT INTO viewspot_photos (id, viewspot_id, url, ord) VALUES (?,?,?,?)');
const delPhotos = db.prepare('DELETE FROM viewspot_photos WHERE viewspot_id = ?');
const delSpot = db.prepare('DELETE FROM viewspots WHERE id = ?');
const listComments = db.prepare(`
  SELECT c.id, c.body, c.created_at, u.name AS user_name
  FROM viewspot_comments c JOIN users u ON u.id = c.user_id
  WHERE c.viewspot_id = ? ORDER BY c.created_at DESC
`);
const insertComment = db.prepare('INSERT INTO viewspot_comments (id, viewspot_id, user_id, body) VALUES (?,?,?,?)');

// Build ordered photo urls from a manifest (['file'|'url:...']) + uploaded files.
function orderedPhotos(body, files) {
  let manifest = [];
  try { manifest = JSON.parse(body.photo_manifest || '[]'); } catch { manifest = []; }
  let fi = 0;
  let out = [];
  if (manifest.length) {
    for (const t of manifest) {
      if (t === 'file') { if (files[fi]) out.push(`/uploads/${files[fi++].filename}`); }
      else if (typeof t === 'string' && t.startsWith('url:')) out.push(t.slice(4));
    }
  } else {
    out = (files || []).map((f) => `/uploads/${f.filename}`);
  }
  return out.filter(Boolean);
}

router.get('/', (req, res) => res.json(listStmt.all()));

router.get('/:id', (req, res) => {
  const spot = getStmt.get(req.params.id);
  if (!spot) return res.status(404).json({ error: 'not found' });
  res.json({
    ...spot,
    photos: photosStmt.all(spot.id).map((p) => p.url),
    comments: listComments.all(spot.id),
    canEdit: !!req.user && (req.user.id === spot.created_by || isAdmin(req.user)),
  });
});

router.post('/', requireAuth, upload.array('photos', 10), (req, res) => {
  const b = req.body || {};
  const files = req.files || [];
  const cleanup = () => files.forEach((f) => fs.unlink(f.path, () => {}));
  const name = (b.name || '').trim();
  const lat = Number(b.lat); const lng = Number(b.lng);
  const photos = orderedPhotos(b, files);
  if (!name) { cleanup(); return res.status(400).json({ error: '장소 이름을 입력하세요.' }); }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) { cleanup(); return res.status(400).json({ error: '위치를 지정하세요.' }); }
  if (!photos.length) { cleanup(); return res.status(400).json({ error: '사진을 한 장 이상 올려주세요.' }); }

  const id = crypto.randomUUID();
  db.transaction(() => {
    insertSpot.run({ id, name, lat, lng, photo_url: photos[0], created_by: req.user.id });
    photos.forEach((url, i) => insertPhoto.run(crypto.randomUUID(), id, url, i));
  })();
  res.status(201).json(getStmt.get(id));
});

router.patch('/:id', requireAuth, upload.array('photos', 10), (req, res) => {
  const spot = getStmt.get(req.params.id);
  const files = req.files || [];
  const cleanup = () => files.forEach((f) => fs.unlink(f.path, () => {}));
  if (!spot) { cleanup(); return res.status(404).json({ error: 'not found' }); }
  if (req.user.id !== spot.created_by && !isAdmin(req.user)) { cleanup(); return res.status(403).json({ error: '수정 권한이 없습니다.' }); }
  const b = req.body || {};
  const name = (b.name || '').trim() || spot.name;
  const photos = ('photo_manifest' in b) ? orderedPhotos(b, files) : null;
  if (photos && !photos.length) { cleanup(); return res.status(400).json({ error: '사진을 한 장 이상 남겨주세요.' }); }

  db.transaction(() => {
    db.prepare('UPDATE viewspots SET name = ?, photo_url = ? WHERE id = ?')
      .run(name, photos ? photos[0] : spot.photo_url, spot.id);
    if (photos) {
      delPhotos.run(spot.id);
      photos.forEach((url, i) => insertPhoto.run(crypto.randomUUID(), spot.id, url, i));
    }
  })();
  res.json(getStmt.get(spot.id));
});

router.delete('/:id', requireAuth, (req, res) => {
  const spot = getStmt.get(req.params.id);
  if (!spot) return res.status(404).json({ error: 'not found' });
  if (req.user.id !== spot.created_by && !isAdmin(req.user)) return res.status(403).json({ error: '삭제 권한이 없습니다.' });
  delSpot.run(spot.id);
  res.json({ ok: true });
});

router.post('/:id/comments', requireAuth, express.json(), (req, res) => {
  if (!getStmt.get(req.params.id)) return res.status(404).json({ error: 'not found' });
  const body = (req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: '댓글을 입력하세요.' });
  const id = crypto.randomUUID();
  insertComment.run(id, req.params.id, req.user.id, body);
  res.status(201).json(listComments.all(req.params.id)[0]);
});

module.exports = router;
