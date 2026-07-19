'use strict';

// Image proxy for Kakao/Naver CDN photos, which block hotlinking by referer.
// We fetch server-side (no referer, browser UA) and stream the bytes. Host is
// allowlisted to specific image CDNs (SSRF-safe). Results are cached by the browser.

const express = require('express');
const router = express.Router();

const ALLOW = /(^|\.)(kakaocdn\.net|daumcdn\.net|pstatic\.net)$/i;

router.get('/', async (req, res) => {
  const u = req.query.u;
  if (!u) return res.status(400).end();
  let url;
  try { url = new URL(u); } catch { return res.status(400).end(); }
  if (!/^https?:$/.test(url.protocol) || !ALLOW.test(url.hostname)) return res.status(400).end();

  try {
    const r = await fetch(url.href, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/*,*/*' },
      redirect: 'follow',
    });
    if (!r.ok) return res.status(502).end();
    const ct = r.headers.get('content-type') || 'image/jpeg';
    if (!/^image\//.test(ct)) return res.status(415).end();
    res.set('Content-Type', ct);
    res.set('Cache-Control', 'public, max-age=604800');
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch {
    res.status(502).end();
  }
});

module.exports = router;
