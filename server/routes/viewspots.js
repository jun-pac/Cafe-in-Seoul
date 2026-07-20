'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { processUploads } = require('../images');
const { sendAdminAlert } = require('../mailer');
const db = require('../db');
const kakao = require('../kakao');
const { requireAuth, requireAdmin, isAdmin } = require('../auth');

const router = express.Router();

// place search by name → coordinates (any logged-in user; view-spots aren't admin-only)
router.get('/search', requireAuth, async (req, res, next) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: '검색어가 필요합니다.' });
  if (!kakao.HAS_KAKAO) return res.status(503).json({ error: '검색이 설정되지 않았습니다. 지도에서 위치를 선택하세요.' });
  try { res.json({ results: await kakao.searchPlaces(q) }); }
  catch (e) { next(e); }
});

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

const listStmt = db.prepare('SELECT id, name, lat, lng, photo_url, status, created_by FROM viewspots');
const getStmt = db.prepare('SELECT * FROM viewspots WHERE id = ?');
const photosMetaStmt = db.prepare(`SELECT vp.url, u.name AS uploader
  FROM viewspot_photos vp LEFT JOIN users u ON u.id = vp.created_by
  WHERE vp.viewspot_id = ? ORDER BY vp.ord`);
const photoOwnersStmt = db.prepare('SELECT url, created_by FROM viewspot_photos WHERE viewspot_id = ?');
const userNameStmt = db.prepare('SELECT name FROM users WHERE id = ?');
const insertSpot = db.prepare(`INSERT INTO viewspots (id, name, lat, lng, photo_url, created_by, status) VALUES (@id,@name,@lat,@lng,@photo_url,@created_by,@status)`);
const setVsApproved = db.prepare(`UPDATE viewspots SET status='approved' WHERE id=?`);
const setVsRejected = db.prepare(`UPDATE viewspots SET status='rejected' WHERE id=?`);
const insertPhoto = db.prepare('INSERT INTO viewspot_photos (id, viewspot_id, url, ord, created_by) VALUES (?,?,?,?,?)');
const maxOrdStmt = db.prepare('SELECT COALESCE(MAX(ord), -1) AS m FROM viewspot_photos WHERE viewspot_id = ?');
// a user can't create the same spot twice (same name + ~same place, ~55m). Blocks the
// double-submit that made 5× 잠수교 when slow uploads got clicked repeatedly.
const findDupeSpot = db.prepare(`SELECT id, status FROM viewspots
  WHERE created_by = ? AND name = ? AND status != 'rejected'
    AND ABS(lat - ?) < 0.0005 AND ABS(lng - ?) < 0.0005
  ORDER BY rowid DESC LIMIT 1`);
const delPhotos = db.prepare('DELETE FROM viewspot_photos WHERE viewspot_id = ?');
const delSpot = db.prepare('DELETE FROM viewspots WHERE id = ?');
const listComments = db.prepare(`
  SELECT c.id, c.body, c.created_at, u.name AS user_name
  FROM viewspot_comments c JOIN users u ON u.id = c.user_id
  WHERE c.viewspot_id = ? ORDER BY c.created_at DESC
`);
const insertComment = db.prepare('INSERT INTO viewspot_comments (id, viewspot_id, user_id, body) VALUES (?,?,?,?)');
const likeCountStmt = db.prepare('SELECT COUNT(*) AS n FROM viewspot_likes WHERE viewspot_id = ?');
const likedStmt = db.prepare('SELECT 1 FROM viewspot_likes WHERE viewspot_id = ? AND user_id = ?');
const insertLike = db.prepare('INSERT OR IGNORE INTO viewspot_likes (viewspot_id, user_id) VALUES (?, ?)');
const deleteLike = db.prepare('DELETE FROM viewspot_likes WHERE viewspot_id = ? AND user_id = ?');
const allLikeCounts = db.prepare('SELECT viewspot_id, COUNT(*) AS n FROM viewspot_likes GROUP BY viewspot_id');

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

router.get('/', (req, res) => {
  const uid = req.user?.id;
  const admin = isAdmin(req.user);
  const likes = {};
  allLikeCounts.all().forEach((r) => { likes[r.viewspot_id] = r.n; });
  res.json(listStmt.all().filter((v) =>
    v.status !== 'rejected' && (v.status === 'approved' || admin || (uid && v.created_by === uid))
  ).map((v) => ({ ...v, likes: likes[v.id] || 0 })));
});

router.get('/:id', (req, res) => {
  const spot = getStmt.get(req.params.id);
  if (!spot) return res.status(404).json({ error: 'not found' });
  const meta = photosMetaStmt.all(spot.id); // [{ url, uploader }]
  res.json({
    ...spot,
    photos: meta.map((p) => p.url),
    photoMeta: meta,
    creator_name: spot.created_by ? (userNameStmt.get(spot.created_by)?.name || null) : null,
    comments: listComments.all(spot.id),
    likes: likeCountStmt.get(spot.id).n,
    liked: !!(req.user && likedStmt.get(spot.id, req.user.id)),
    canEdit: !!req.user && (req.user.id === spot.created_by || isAdmin(req.user)),
  });
});

router.post('/', requireAuth, upload.array('photos', 30), async (req, res) => {
  const b = req.body || {};
  const files = req.files || [];
  const cleanup = () => files.forEach((f) => fs.unlink(f.path, () => {}));
  await processUploads(files); // compress + thumbnails
  const name = (b.name || '').trim();
  const lat = Number(b.lat); const lng = Number(b.lng);
  const photos = orderedPhotos(b, files);
  if (!name) { cleanup(); return res.status(400).json({ error: '장소 이름을 입력하세요.' }); }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) { cleanup(); return res.status(400).json({ error: '위치를 지정하세요.' }); }
  if (!photos.length) { cleanup(); return res.status(400).json({ error: '사진을 한 장 이상 올려주세요.' }); }

  // Idempotency guard — the structural fix for double-submits. There is NO awaited work
  // between this check and the synchronous insert below, and better-sqlite3 is synchronous,
  // so two racing requests can't both pass: whichever runs its check+insert first wins, and
  // the other sees the row and returns it. No duplicate can be created.
  const dupe = findDupeSpot.get(req.user.id, name, lat, lng);
  if (dupe) { cleanup(); return res.json({ ...getStmt.get(dupe.id), pending: dupe.status === 'pending', deduped: true }); }

  // admins publish immediately; everyone else PROPOSES (pending)
  const admin = isAdmin(req.user);
  const status = admin ? 'approved' : 'pending';
  const id = crypto.randomUUID();
  db.transaction(() => {
    insertSpot.run({ id, name, lat, lng, photo_url: photos[0], created_by: req.user.id, status });
    photos.forEach((url, i) => insertPhoto.run(crypto.randomUUID(), id, url, i, req.user.id));
  })();
  if (!admin) {
    sendAdminAlert(
      `[Cafe in Seoul] 새 뷰맛집 제안: ${name}`,
      `${req.user.name || req.user.id} 님이 뷰맛집을 제안했습니다.\n\n이름: ${name}\n좌표: ${lat}, ${lng}\n\n관리자로 로그인해 심사 대기열에서 승인/거절하세요:\n${process.env.BASE_URL || ''}`
    ).catch(() => {});
  }
  res.status(201).json({ ...getStmt.get(id), pending: !admin });
});

router.patch('/:id', requireAuth, upload.array('photos', 30), async (req, res) => {
  const spot = getStmt.get(req.params.id);
  const files = req.files || [];
  const cleanup = () => files.forEach((f) => fs.unlink(f.path, () => {}));
  if (!spot) { cleanup(); return res.status(404).json({ error: 'not found' }); }
  if (req.user.id !== spot.created_by && !isAdmin(req.user)) { cleanup(); return res.status(403).json({ error: '수정 권한이 없습니다.' }); }
  await processUploads(files); // compress + thumbnails
  const b = req.body || {};
  const name = (b.name || '').trim() || spot.name;
  // location is editable too (re-search picks a new place) — keep old value if not sent/invalid
  const lat = Number.isFinite(Number(b.lat)) ? Number(b.lat) : spot.lat;
  const lng = Number.isFinite(Number(b.lng)) ? Number(b.lng) : spot.lng;
  const photos = ('photo_manifest' in b) ? orderedPhotos(b, files) : null;
  if (photos && !photos.length) { cleanup(); return res.status(400).json({ error: '사진을 한 장 이상 남겨주세요.' }); }

  // keep each kept photo's original uploader; new photos are attributed to the editor
  const currentRows = photoOwnersStmt.all(spot.id);
  const owners = new Map(currentRows.map((r) => [r.url, r.created_by]));
  db.transaction(() => {
    let finalPhotos = photos;
    if (photos) {
      // DATA SAFETY: an edit must never silently drop a photo the editor didn't have
      // loaded — most importantly a shot CONTRIBUTED by another user (appended to this
      // spot). Those are preserved even if the manifest omits them, so they can't vanish.
      // The editor can still reorder/remove their OWN photos and set the cover.
      const inManifest = new Set(photos);
      const protectedExtras = currentRows
        .filter((r) => !inManifest.has(r.url) && r.created_by && r.created_by !== req.user.id)
        .map((r) => r.url);
      finalPhotos = [...photos, ...protectedExtras];
    }
    db.prepare('UPDATE viewspots SET name = ?, lat = ?, lng = ?, photo_url = ? WHERE id = ?')
      .run(name, lat, lng, photos ? photos[0] : spot.photo_url, spot.id);
    if (photos) {
      delPhotos.run(spot.id);
      finalPhotos.forEach((url, i) => insertPhoto.run(crypto.randomUUID(), spot.id, url, i, owners.get(url) || req.user.id));
    }
  })();
  res.json(getStmt.get(spot.id));
});

// APPEND photos to an existing view-spot — any logged-in user (contribute your own
// shots to someone else's spot). Each new photo is attributed to the uploader.
router.post('/:id/photos', requireAuth, upload.array('photos', 30), async (req, res) => {
  const spot = getStmt.get(req.params.id);
  const files = req.files || [];
  const cleanup = () => files.forEach((f) => fs.unlink(f.path, () => {}));
  if (!spot) { cleanup(); return res.status(404).json({ error: 'not found' }); }
  await processUploads(files);
  const urls = files.map((f) => `/uploads/${f.filename}`);
  if (!urls.length) { cleanup(); return res.status(400).json({ error: '사진을 올려주세요.' }); }
  let ord = maxOrdStmt.get(spot.id).m + 1;
  db.transaction(() => {
    urls.forEach((url) => insertPhoto.run(crypto.randomUUID(), spot.id, url, ord++, req.user.id));
  })();
  res.json(getStmt.get(spot.id));
});

// admin: pending view-spot proposals + approve/reject
router.get('/pending/list', requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT id, name, lat, lng, photo_url, created_by FROM viewspots WHERE status='pending' ORDER BY rowid DESC").all();
  res.json(rows.map((v) => ({ ...v, creator_name: v.created_by ? (userNameStmt.get(v.created_by)?.name || null) : null })));
});
router.post('/:id/approve', requireAdmin, express.json(), (req, res) => {
  if (!getStmt.get(req.params.id)) return res.status(404).json({ error: 'not found' });
  setVsApproved.run(req.params.id);
  res.json({ ok: true });
});
router.post('/:id/reject', requireAdmin, express.json(), (req, res) => {
  if (!getStmt.get(req.params.id)) return res.status(404).json({ error: 'not found' });
  setVsRejected.run(req.params.id); // soft delete (row preserved)
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, (req, res) => {
  const spot = getStmt.get(req.params.id);
  if (!spot) return res.status(404).json({ error: 'not found' });
  if (req.user.id !== spot.created_by && !isAdmin(req.user)) return res.status(403).json({ error: '삭제 권한이 없습니다.' });
  delSpot.run(spot.id);
  res.json({ ok: true });
});

// toggle 따봉 (like). The like count decides which view-spot survives on overlap.
router.post('/:id/like', requireAuth, express.json(), (req, res) => {
  if (!getStmt.get(req.params.id)) return res.status(404).json({ error: 'not found' });
  const liked = !!likedStmt.get(req.params.id, req.user.id);
  if (liked) deleteLike.run(req.params.id, req.user.id);
  else insertLike.run(req.params.id, req.user.id);
  res.json({ liked: !liked, likes: likeCountStmt.get(req.params.id).n });
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
