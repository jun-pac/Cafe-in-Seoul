'use strict';

// Image optimization. Phone photos are 3–5MB / 3000px+; serving those raw into
// 138px map cards is what makes the map lag. On upload we compress each image in
// place to a web-friendly "main" (<=1600px, q82) and write a small "_thumb.jpg"
// (<=480px, q72) next to it. The filename/URL is unchanged (main stays in place),
// so the DB needs no migration; the thumbnail is derived by convention.
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const UPLOADS = path.join(__dirname, '..', 'uploads');
const MAIN = { width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true };
const THUMB = { width: 480, height: 480, fit: 'inside', withoutEnlargement: true };

function thumbPathFor(filename) {
  return `${filename.replace(/\.[^.]+$/, '')}_thumb.jpg`;
}

// Compress one saved upload in place + write its thumbnail. Keeps the original
// filename (and thus its URL) so nothing in the DB has to change.
async function processUploadFile(filename) {
  const mainPath = path.join(UPLOADS, filename);
  let buf;
  try { buf = fs.readFileSync(mainPath); } catch { return; }
  try {
    const main = await sharp(buf).rotate() // .rotate() honours EXIF orientation (phone photos)
      .resize(MAIN).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    const thumb = await sharp(buf).rotate()
      .resize(THUMB).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
    fs.writeFileSync(mainPath, main); // overwrite original bytes; URL unchanged
    fs.writeFileSync(path.join(UPLOADS, thumbPathFor(filename)), thumb);
  } catch (e) {
    // corrupt / non-image → leave the original untouched rather than lose it, but
    // still put *something* at the thumb path so the derived thumb URL never 404s.
    console.error('image optimize failed for', filename, e.message);
    try {
      const tp = path.join(UPLOADS, thumbPathFor(filename));
      if (!fs.existsSync(tp)) fs.copyFileSync(mainPath, tp);
    } catch { /* ignore */ }
  }
}

// Process a multer req.files array (sequential — gentle on memory for big batches).
async function processUploads(files) {
  for (const f of files || []) await processUploadFile(f.filename);
  return files;
}

module.exports = { processUploads, processUploadFile, thumbPathFor };
