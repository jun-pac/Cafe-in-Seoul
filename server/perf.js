'use strict';

// Latency instrumentation — three lenses, all in-memory (no DB writes, so it adds
// ~nothing to a request and can't touch stored data). Restart clears it.
//   1. server timing  — how long WE take per route (timing middleware)
//   2. client RUM      — what real browsers measure (TTFB, LCP, map-render) via /api/perf
//   3. asset audit      — the photo library on disk (oversized files, missing thumbs)
// Surface it all at GET /api/admin/perf and in scripts/perf-report.js.

const fs = require('fs');
const path = require('path');

const UPLOADS = path.join(__dirname, '..', 'uploads');
const SERVER_CAP = 4000; // ring buffer of recent requests
const CLIENT_CAP = 600;  // ring buffer of recent real-user page loads

const serverSamples = []; // { route, method, status, ms, bytes, ts }
const clientSamples = []; // { ttfb, dcl, load, lcp, mapReady, markers, nav, ua, ts }

function push(buf, cap, s) { buf.push(s); if (buf.length > cap) buf.splice(0, buf.length - cap); }

// Collapse ids so /api/cafes/<uuid>/reviews and /cafes/kenya-kiambu-9a03651c group together.
function normRoute(method, p) {
  const clean = p.split('?')[0]
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:id') // uuid
    .replace(/\/[a-z0-9-]*-[0-9a-f]{8}(?=\/|$)/gi, '/:slug') // seo slug (…-8hex)
    .replace(/\/\d+(?=\/|$)/g, '/:n');
  return `${method} ${clean || '/'}`;
}

// Express middleware: time every request, record on finish. Mount as early as possible.
function timing(req, res, next) {
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    try {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      const len = Number(res.getHeader('content-length'));
      push(serverSamples, SERVER_CAP, {
        route: normRoute(req.method, req.path),
        status: res.statusCode,
        ms: Math.round(ms * 10) / 10,
        bytes: Number.isFinite(len) ? len : null,
        ts: Date.now(),
      });
    } catch { /* never break a response */ }
  });
  next();
}

const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0);
function summarize(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return { n: s.length, min: s[0], p50: pct(s, 0.5), p95: pct(s, 0.95), p99: pct(s, 0.99), max: s[s.length - 1], avg: Math.round((sum / s.length) * 10) / 10 };
}

// Per-route latency, worst p95 first.
function serverStats() {
  const byRoute = new Map();
  let bytesTotal = 0, bytesN = 0;
  for (const s of serverSamples) {
    if (!byRoute.has(s.route)) byRoute.set(s.route, { ms: [], bytes: [], errors: 0 });
    const g = byRoute.get(s.route);
    g.ms.push(s.ms);
    if (s.bytes != null) { g.bytes.push(s.bytes); bytesTotal += s.bytes; bytesN++; }
    if (s.status >= 500) g.errors++;
  }
  const routes = [...byRoute.entries()].map(([route, g]) => ({
    route, count: g.ms.length, errors: g.errors,
    ms: summarize(g.ms),
    avgBytes: g.bytes.length ? Math.round(g.bytes.reduce((a, b) => a + b, 0) / g.bytes.length) : null,
  })).sort((a, b) => (b.ms?.p95 || 0) - (a.ms?.p95 || 0));
  const span = serverSamples.length ? (serverSamples[serverSamples.length - 1].ts - serverSamples[0].ts) : 0;
  return { sampleCount: serverSamples.length, windowMinutes: Math.round(span / 60000), avgResponseBytes: bytesN ? Math.round(bytesTotal / bytesN) : null, routes };
}

// Real-user metrics reported by the browser beacon.
function recordClient(b) {
  const num = (x) => (typeof x === 'number' && isFinite(x) && x >= 0 && x < 600000 ? Math.round(x) : null);
  push(clientSamples, CLIENT_CAP, {
    ttfb: num(b.ttfb), dcl: num(b.dcl), load: num(b.load), lcp: num(b.lcp),
    mapReady: num(b.mapReady), markers: num(b.markers),
    nav: (b.nav || '').toString().slice(0, 20), ts: Date.now(),
  });
}
function clientStats() {
  const col = (k) => clientSamples.map((s) => s[k]).filter((x) => x != null);
  return {
    sampleCount: clientSamples.length,
    ttfb: summarize(col('ttfb')), dcl: summarize(col('dcl')), load: summarize(col('load')),
    lcp: summarize(col('lcp')), mapReady: summarize(col('mapReady')), markers: summarize(col('markers')),
  };
}

// The photo library on disk: what a slow page is actually downloading. Fast (fs.stat only).
function assetAudit() {
  let files;
  try { files = fs.readdirSync(UPLOADS); } catch { return { error: 'no uploads dir' }; }
  const isImg = (f) => /\.(jpe?g|png|webp)$/i.test(f);
  const origs = files.filter((f) => isImg(f) && !/_thumb\.[^.]+$/i.test(f));
  const stat = (f) => { try { return fs.statSync(path.join(UPLOADS, f)).size; } catch { return 0; } };
  const thumbName = (f) => `${f.replace(/\.[^.]+$/, '')}_thumb.jpg`;

  let origBytes = 0, thumbBytes = 0;
  const missingThumbs = [], oversizedOrig = [], oversizedThumb = [], all = [];
  for (const f of origs) {
    const size = stat(f);
    if (size <= 100) continue; // skip 70-byte placeholder pngs
    origBytes += size;
    all.push({ file: f, size });
    const tn = thumbName(f);
    if (!files.includes(tn)) { missingThumbs.push(f); continue; }
    const tsize = stat(tn);
    thumbBytes += tsize;
    if (size > 1024 * 1024) oversizedOrig.push({ file: f, kb: Math.round(size / 1024) });
    if (tsize > 150 * 1024) oversizedThumb.push({ file: tn, kb: Math.round(tsize / 1024) }); // a "thumb" that never got shrunk
  }
  all.sort((a, b) => b.size - a.size);
  return {
    originals: all.length,
    totalOriginalMB: Math.round((origBytes / 1048576) * 10) / 10,
    totalThumbMB: Math.round((thumbBytes / 1048576) * 10) / 10,
    avgOriginalKB: all.length ? Math.round(origBytes / all.length / 1024) : 0,
    avgThumbKB: all.length ? Math.round(thumbBytes / all.length / 1024) : 0,
    missingThumbs,               // originals with no _thumb (map card falls back to full file)
    oversizedOriginals: oversizedOrig.sort((a, b) => b.kb - a.kb), // >1MB, escaped the 1600px/q82 pass
    oversizedThumbs: oversizedThumb.sort((a, b) => b.kb - a.kb),   // >150KB, thumbnail generation failed
    largest: all.slice(0, 10).map((x) => ({ file: x.file, kb: Math.round(x.size / 1024) })),
  };
}

module.exports = { timing, serverStats, recordClient, clientStats, assetAudit };
