'use strict';

// Sets a photo URL as the cafe's representative: it becomes photo_url AND the
// first cafe_photo (so it's also gallery[0] — the detail hero and the map card
// stay consistent). Keeps the other existing cafe photos after it.
const crypto = require('crypto');
const db = require('./db');

const cafePhotosStmt = db.prepare('SELECT url FROM cafe_photos WHERE cafe_id = ? ORDER BY ord');
const getCafeStmt = db.prepare('SELECT photo_url FROM cafes WHERE id = ?');
const delCafePhotos = db.prepare('DELETE FROM cafe_photos WHERE cafe_id = ?');
const insertCafePhoto = db.prepare('INSERT INTO cafe_photos (id, cafe_id, url, ord) VALUES (?,?,?,?)');
const setPhotoUrl = db.prepare('UPDATE cafes SET photo_url = ? WHERE id = ?');

function setCafeCover(cafeId, url) {
  if (!url) return;
  const existing = cafePhotosStmt.all(cafeId).map((p) => p.url);
  const base = existing.length ? existing : [getCafeStmt.get(cafeId)?.photo_url].filter(Boolean);
  const list = [url, ...base.filter((u) => u && u !== url)];
  db.transaction(() => {
    delCafePhotos.run(cafeId);
    list.forEach((u, i) => insertCafePhoto.run(crypto.randomUUID(), cafeId, u, i));
    setPhotoUrl.run(url, cafeId);
  })();
}

module.exports = { setCafeCover };
