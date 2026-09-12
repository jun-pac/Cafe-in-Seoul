'use strict';

// ---------------------------------------------------------------------------
// SEO layer: server-rendered, crawlable pages for every cafe and view-spot.
//
// The app itself is a client-rendered map — a search engine that loads "/" sees
// an almost-empty shell. This module gives each place a real URL that returns
// full HTML (title, description, <h1>, natural-language body, <img> with alt,
// JSON-LD, canonical, hreflang) so Google / ChatGPT can actually read and rank
// it. The interactive map is untouched; these pages link into it.
//
// URLs (ko is default, en is the translated twin built from the *_en columns):
//   /cafes                     /en/cafes         directory (links to every page)
//   /cafes/<name>-<id8>        /en/cafes/<...>   one cafe
//   /views                     /en/views         directory
//   /views/<name>-<id8>        /en/views/<...>   one view-spot
//   /sitemap.xml  /robots.txt
// ---------------------------------------------------------------------------

const express = require('express');
const db = require('./db');
const { decorate } = require('./cafeModel');
const { opensLate } = require('./score');
const { recordEvent, isBotUA } = require('./analytics');

const BASE = (process.env.BASE_URL || 'https://cafe-in-seoul.com').replace(/\/$/, '');
const CARTO_KEY = process.env.CARTO_API_KEY || ''; // for the static map-preview tiles on SEO pages

// ---- escaping --------------------------------------------------------------
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
// JSON-LD is injected inside <script>; only "<" can break out — neutralize it.
const jsonld = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

// ---- slugs -----------------------------------------------------------------
// slug = ascii-ized name + short id. The id suffix makes it unique and lets us
// resolve the row even if the name part drifts (we 301 to the canonical slug).
function slugify(s) {
  return String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')  // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
const shortId = (id) => String(id).replace(/-/g, '').slice(0, 8);
const cafeSlug = (c) => `${slugify(c.name_en || c.name) || 'cafe'}-${shortId(c.id)}`;
const viewSlug = (v) => `${slugify(v.name_en || v.name) || 'view'}-${shortId(v.id)}`;

// pull the trailing 8-hex id off a slug and find the row whose id starts with it
const idFromSlug = (slug) => {
  const m = /([0-9a-f]{8})$/i.exec(String(slug || ''));
  return m ? m[1].toLowerCase() : null;
};
const getCafeBySlug = (slug) => {
  const id8 = idFromSlug(slug);
  if (!id8) return null;
  return db.prepare(`SELECT * FROM cafes WHERE status='approved' AND replace(id,'-','') LIKE ?`).get(id8 + '%') || null;
};
const getViewBySlug = (slug) => {
  const id8 = idFromSlug(slug);
  if (!id8) return null;
  return db.prepare(`SELECT * FROM viewspots WHERE status='approved' AND replace(id,'-','') LIKE ?`).get(id8 + '%') || null;
};

// ---- images ----------------------------------------------------------------
const CDN = /(^|\.)(kakaocdn\.net|daumcdn\.net|pstatic\.net)$/i;
// local uploads are served as-is; hotlink-blocked CDN photos go through our proxy
function imgPath(u) {
  if (!u) return null;
  if (u.startsWith('/uploads/')) return u;
  try { if (CDN.test(new URL(u).hostname)) return '/api/img?u=' + encodeURIComponent(u); } catch { /* not absolute */ }
  return u;
}
const absUrl = (p) => (p && p.startsWith('http') ? p : BASE + p);
const absImg = (u) => { const p = imgPath(u); return p ? absUrl(p) : null; };

// ---- shared field vocabulary ----------------------------------------------
const SIZE = { small: ['작은', 'small'], medium: ['중간 크기의', 'mid-sized'], large: ['넓은', 'spacious'] };
// complete sentences (ko) / noun phrases (en) about the outlets
const OUTLET_KO = { many: '콘센트가 많습니다', some: '콘센트가 어느 정도 있습니다', few: '콘센트가 적은 편입니다', none: '콘센트가 거의 없습니다' };
const OUTLET_EN = { many: 'plenty of power outlets', some: 'a fair number of outlets', few: 'few outlets', none: 'almost no outlets' };
const OUTLET_N = { many: ['많음', 'Many'], some: ['보통', 'Some'], few: ['적음', 'Few'], none: ['없음', 'None'] };
const SIZE_N = { small: ['작음', 'Small'], medium: ['중간', 'Medium'], large: ['넓음', 'Large'] };
const won = (n) => Number(n).toLocaleString('en-US');

// district out of a Korean address ("서울 용산구 …" → "용산구"). No \b: Korean
// isn't a JS "word" char, so a boundary after 구 never matches.
function district(addr) {
  const m = /([가-힣]+구)/.exec(addr || '');
  return m ? m[1] : null;
}
// same from a translated address ("…, Yongsan-gu, Seoul" → "Yongsan-gu")
function districtEn(addr) {
  const m = /([A-Za-z]+-?gu)\b/i.exec(addr || '');
  return m ? m[1] : null;
}
// the district label to show for the given language
const guOf = (row, ko) => (ko ? district(row.address) : (districtEn(row.address_en) || district(row.address)));

// ---- region (city/district) ------------------------------------------------
// No coordinate guessing: cafes carry a Korean address, and view-spots store a
// `region` (+ `region_en`) that was reverse-geocoded from their lat/lng at
// registration ("인천 제물포구"). We just read those.
const METRO_KO = { 서울: 'Seoul', 부산: 'Busan', 인천: 'Incheon', 대구: 'Daegu', 대전: 'Daejeon', 광주: 'Gwangju', 울산: 'Ulsan', 세종: 'Sejong' };
// province/metro → English, for the EN fallback when a view-spot's region_en isn't translated yet
const SIDO_EN = { ...METRO_KO, 경기: 'Gyeonggi', 강원: 'Gangwon', 충북: 'Chungcheongbuk-do', 충남: 'Chungcheongnam-do', 전북: 'Jeollabuk-do', 전남: 'Jeollanam-do', 경북: 'Gyeongsangbuk-do', 경남: 'Gyeongsangnam-do', 제주: 'Jeju' };
const regionEnFallback = (ko) => SIDO_EN[(ko || '').split(/\s+/)[0]] || ko || '';

function regionFromAddress(addr, addrEn) {
  const t = (addr || '').trim().split(/\s+/);
  if (!t[0]) return null;
  for (const ko of Object.keys(METRO_KO)) if (t[0].startsWith(ko)) return { ko, en: METRO_KO[ko], isMetro: true };
  // a province address → use the city (…시 / …군), matched in both languages
  const cityKo = t.find((x) => /(시|군)$/.test(x)) || t[1] || t[0];
  const cityEn = (addrEn || '').split(',').map((s) => s.trim()).find((x) => /-(si|gun)$/i.test(x));
  return { ko: cityKo.replace(/시$/, ''), en: cityEn ? cityEn.replace(/-si$/i, '') : cityKo.replace(/시$/, ''), isMetro: false };
}
// { ko, en, isMetro } or null. Cafe → its address; view-spot → its stored region.
function regionOf(row) {
  if (row.address) return regionFromAddress(row.address, row.address_en);
  if (row.region) return { ko: row.region, en: row.region_en || regionEnFallback(row.region), isMetro: false };
  return null;
}
// "서울 용산구" / "Yongsan-gu, Seoul" for metros; just the city otherwise. null → ''.
function regionPhrase(row, ko) {
  const r = regionOf(row);
  if (!r) return '';
  if (!r.isMetro) return ko ? r.ko : r.en;
  const gu = ko ? district(row.address) : (districtEn(row.address_en) || district(row.address));
  return ko ? `${r.ko}${gu ? ' ' + gu : ''}` : `${gu ? gu + ', ' : ''}${r.en}`;
}
const regionCity = (row, ko) => { const r = regionOf(row); return r ? (ko ? r.ko : r.en) : ''; };

// pick the right Korean subject particle (은/는) for a word by its final consonant
function eunNeun(word) {
  const c = (word || '').trim().slice(-1).charCodeAt(0);
  if (c < 0xac00 || c > 0xd7a3) return '는';        // not Hangul → default
  return (c - 0xac00) % 28 !== 0 ? '은' : '는';       // has a final consonant → 은
}

// ---- page chrome -----------------------------------------------------------
// One HTML skeleton for every page. Reuses the site stylesheet so the pages look
// native, plus a little page-specific CSS for the article layout.
function shell({ lang, title, desc, canonical, alternates, jsonLd, body, ogImage, extraCss }) {
  const alt = (alternates || []).map((a) => `<link rel="alternate" hreflang="${a.hreflang}" href="${esc(a.href)}" />`).join('\n  ');
  const og = ogImage ? `
  <meta property="og:image" content="${esc(ogImage)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="${esc(ogImage)}" />` : '';
  const ld = (jsonLd || []).map((o) => `<script type="application/ld+json">${jsonld(o)}</script>`).join('\n  ');
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="referrer" content="no-referrer" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}" />
  <link rel="canonical" href="${esc(canonical)}" />
  ${alt}
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="Cafe in Seoul" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:locale" content="${lang === 'en' ? 'en_US' : 'ko_KR'}" />${og}
  <link rel="icon" type="image/png" href="/icon-192.png" />
  <link rel="stylesheet" href="/css/style.css" />
  ${ld}
  <style>
    .seo { max-width: 760px; margin: 0 auto; padding: 22px 20px 64px; }
    .seo a { color: inherit; }
    .seo-top { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--mute); margin-bottom: 18px; }
    .seo-top a { text-decoration: none; }
    .seo h1 { font-family: var(--font-display); font-size: 27px; font-weight: 800; letter-spacing: -.2px; margin: 0 0 6px; }
    .seo .sub { color: var(--ink-2); font-size: 14px; margin: 0 0 18px; }
    .seo-hero { width: 100%; aspect-ratio: 16/10; object-fit: cover; border-radius: var(--r-md); background: var(--surface-2); display: block; }
    .seo-lead { font-size: 16px; line-height: 1.7; margin: 20px 0; }
    .seo h2 { font-size: 15px; font-weight: 800; text-transform: uppercase; letter-spacing: .4px; color: var(--ink-2); margin: 30px 0 10px; }
    .seo-badge { display: inline-flex; align-items: baseline; gap: 6px; background: var(--ink); color: #fff; border-radius: var(--pill); padding: 5px 13px; font-weight: 800; font-family: var(--font-display); }
    .seo-badge small { font-weight: 600; font-size: 10px; letter-spacing: .5px; opacity: .8; }
    .seo-spec { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--hair); border: 1px solid var(--hair); border-radius: var(--r-sm); overflow: hidden; }
    .seo-spec li { background: var(--surface); padding: 11px 14px; font-size: 14px; }
    .seo-spec b { display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .3px; color: var(--mute); margin-bottom: 2px; }
    .seo-gallery { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
    .seo-gallery img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: var(--r-sm); background: var(--surface-2); }
    .seo-story { border-left: 3px solid var(--hair-strong); padding: 2px 0 2px 14px; margin: 12px 0; font-size: 14.5px; line-height: 1.65; color: var(--ink-2); }
    /* a.seo-cta (not .seo-cta) so it outweighs ".seo a { color: inherit }" — else white text loses to inherited ink and the button is black-on-black */
    .seo a.seo-cta { display: inline-flex; align-items: center; gap: 7px; margin: 8px 0; padding: 11px 18px; border-radius: var(--pill); background: var(--ink); color: #fff; font-weight: 700; text-decoration: none; }
    .seo a.seo-cta:hover { opacity: .9; }
    .seo-links { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    /* nowrap: a squeezed pill must wrap to the NEXT line as a whole, never break its own
       text into 2 lines (that made "서울 24시간 카페"/"서울 뷰 좋은 카페" taller than the rest) */
    .seo-links a { text-decoration: none; white-space: nowrap; border: 1px solid var(--hair-strong); border-radius: var(--pill); padding: 6px 13px; font-size: 13px; }
    .seo-dir { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
    .seo-dir a { display: flex; gap: 11px; text-decoration: none; align-items: center; }
    .seo-dir img { width: 60px; height: 60px; object-fit: cover; border-radius: var(--r-sm); flex: none; background: var(--surface-2); }
    .seo-dir .n { font-weight: 700; font-size: 14px; }
    .seo-dir .m { font-size: 12px; color: var(--mute); }
    .seo-foot { margin-top: 46px; padding-top: 18px; border-top: 1px solid var(--hair); font-size: 13px; color: var(--mute); display: flex; flex-wrap: wrap; gap: 14px; }
    .seo-foot a { text-decoration: none; }
    /* static map "taste" panel → links into the live map */
    .seo-map { position: relative; display: block; width: 100%; height: 224px; margin: 16px 0 22px; border-radius: var(--r-md); overflow: hidden; background: var(--surface-2); border: 1px solid var(--hair); text-decoration: none; }
    .seo-map__cv { position: absolute; left: 50%; top: 50%; width: ${PV_W}px; height: ${PV_H}px; transform: translate(-50%, -50%); }
    .seo-map__t { position: absolute; width: 256px; height: 256px; }
    .seo-pin { position: absolute; transform: translate(-50%, -50%); width: 30px; height: 30px; border-radius: 7px; border: 2px solid #fff; overflow: hidden; box-shadow: 0 2px 6px rgba(0,0,0,.28); background: var(--surface-2); z-index: 1; }
    .seo-pin img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .seo-pin.is-focus { width: 54px; height: 54px; border-radius: 11px; border: 3px solid var(--ink); box-shadow: 0 4px 14px rgba(0,0,0,.4); z-index: 2; }
    .seo-map__cta { position: absolute; left: 12px; bottom: 12px; z-index: 3; display: inline-flex; align-items: center; background: var(--ink); color: #fff; font-weight: 700; font-size: 13px; padding: 8px 15px; border-radius: var(--pill); box-shadow: 0 2px 10px rgba(0,0,0,.28); }
    .seo-map:hover .seo-map__cta { opacity: .92; }
    ${extraCss || ''}
  </style>
</head>
<body class="seo-page">
  <main class="seo">
${body}
  </main>
</body>
</html>`;
}

// ---- cafe page -------------------------------------------------------------
function cafePhotos(id) {
  return db.prepare('SELECT url FROM cafe_photos WHERE cafe_id=? ORDER BY ord').all(id).map((r) => r.url);
}
function cafeStories(id) {
  return db.prepare(`SELECT body, body_en FROM reviews WHERE cafe_id=? ORDER BY created_at DESC LIMIT 6`).all(id);
}
// a few nearest other cafes — real internal links for the crawl graph + the reader
function nearbyCafes(c, n = 6) {
  return db.prepare(`SELECT id,name,name_en,photo_url,address,address_en,lat,lng,
      (lat-?)*(lat-?)+(lng-?)*(lng-?) AS d2 FROM cafes
     WHERE status='approved' AND id<>? ORDER BY d2 ASC LIMIT ?`).all(c.lat, c.lat, c.lng, c.lng, c.id, n);
}

// ---- static map preview ("taste" of the live map on every SEO page) --------
// CARTO raster tiles centered on `center`, photo pins for the places, the whole panel
// links into the interactive map. Pure server-rendered HTML+CSS (no JS/MapLibre), so it
// stays light and crawlable. The focused place sits dead-center and on top ("surfaced").
function mercator(lat, lng, z) {
  const scale = 256 * Math.pow(2, z);
  const s = Math.max(-0.9999, Math.min(0.9999, Math.sin((lat * Math.PI) / 180)));
  return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale };
}
const PV_W = 1040, PV_H = 360; // fixed inner canvas; the responsive panel clips it
function mapPreview({ center, z = 15, pins = [], href, label }) {
  if (!CARTO_KEY || !center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return '';
  const c = mercator(center.lat, center.lng, z);
  const world = Math.pow(2, z);
  let tiles = '';
  for (let tx = Math.floor((c.x - PV_W / 2) / 256); tx <= Math.floor((c.x + PV_W / 2) / 256); tx++) {
    for (let ty = Math.floor((c.y - PV_H / 2) / 256); ty <= Math.floor((c.y + PV_H / 2) / 256); ty++) {
      if (ty < 0 || ty >= world) continue;
      const wx = ((tx % world) + world) % world;
      tiles += `<img class="seo-map__t" src="https://basemaps.cartocdn.com/rastertiles/light_all/${z}/${wx}/${ty}.png?key=${encodeURIComponent(CARTO_KEY)}" style="left:${Math.round(tx * 256 - c.x + PV_W / 2)}px;top:${Math.round(ty * 256 - c.y + PV_H / 2)}px" alt="" loading="lazy" draggable="false" />`;
    }
  }
  let markers = '';
  for (const p of pins) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const m = mercator(p.lat, p.lng, z);
    const left = Math.round(m.x - c.x + PV_W / 2), top = Math.round(m.y - c.y + PV_H / 2);
    if (left < -60 || left > PV_W + 60 || top < -60 || top > PV_H + 60) continue;
    markers += `<span class="seo-pin${p.focus ? ' is-focus' : ''}" style="left:${left}px;top:${top}px">${p.photo ? `<img src="${esc(thumbPath(p.photo))}" alt="" loading="lazy" draggable="false" />` : ''}</span>`;
  }
  return `<a class="seo-map" href="${esc(href)}" aria-label="${esc(label)}"><span class="seo-map__cv">${tiles}${markers}</span><span class="seo-map__cta">${esc(label)} →</span></a>`;
}

function renderCafe(row, lang) {
  const ko = lang !== 'en';
  const d = decorate(row);
  const name = ko ? row.name : (row.name_en || row.name);
  const addr = ko ? (row.address || '') : (row.address_en || row.address || '');
  const gu = guOf(row, ko);
  const sizeTxt = (SIZE[row.size] || SIZE.medium)[ko ? 0 : 1];
  const hasView = Number(row.has_view) === 1;
  const price = won(row.iced_americano_price);
  const review = ko ? (row.study_review || '') : (row.study_review_en || row.study_review || '');
  const viewNote = ko ? (row.view_note || '') : (row.view_note_en || row.view_note || '');
  // AI search-engine summary (synthesizes every field + votes + verdict). Primary
  // crawlable prose when present; the templated `lead` is the fallback.
  const aiSum = ko ? (row.ai_summary || '') : (row.ai_summary_en || row.ai_summary || '');
  const photos = cafePhotos(row.id);
  const hero = photos[0] || row.photo_url;

  // actual city/district from the address (or coords) — not a hardcoded "Seoul"
  const regKo = regionPhrase(row, true);
  const regEn = regionPhrase(row, false);

  // natural-language lead, so the crawler (and ChatGPT) sees the key facts as prose
  const lead = ko
    ? `${regKo ? `${regKo}에 있는 ` : ''}${sizeTxt} 카공 카페입니다. `
      + `아이스 아메리카노는 ${price}원이고 ${row.open_time}–${row.close_time}에 영업합니다. `
      + `${OUTLET_KO[row.outlets] || OUTLET_KO.some}. `
      + (row.floors >= 2 ? `${row.floors}층 규모입니다. ` : '')
      + (hasView ? '창밖 뷰가 좋습니다. ' : '')
      + `Cafe in Seoul 카공 점수는 ${d.score}점입니다.`
    : `A ${sizeTxt} study-friendly cafe${regEn ? ` in ${regEn}` : ''}. `
      + `An iced americano is ₩${price}, and it's open ${row.open_time}–${row.close_time}. `
      + `There are ${OUTLET_EN[row.outlets] || OUTLET_EN.some}`
      + (row.floors >= 2 ? `, across ${row.floors} floors` : '')
      + (hasView ? ', and it has a good view.' : '.')
      + ` Its Cafe in Seoul study score is ${d.score}/100.`;

  const v = d.votes.averages;
  const rate = (x) => (x == null ? (ko ? '평가 없음' : 'no votes') : `${x}/5`);
  const spec = [
    [ko ? '카공 점수' : 'Study score', `${d.score} / 100`],
    [ko ? '아이스 아메리카노' : 'Iced americano', `₩${price}`],
    [ko ? '영업시간' : 'Hours', `${row.open_time} – ${row.close_time}`],
    [ko ? '층수' : 'Floors', String(row.floors)],
    [ko ? '규모' : 'Size', (SIZE_N[row.size] || SIZE_N.medium)[ko ? 0 : 1]],
    [ko ? '콘센트' : 'Outlets', (OUTLET_N[row.outlets] || OUTLET_N.some)[ko ? 0 : 1]],
    [ko ? '조용함(집단지성)' : 'Quiet (crowd)', rate(v.quiet)],
    [ko ? '커피맛(집단지성)' : 'Coffee (crowd)', rate(v.coffee)],
    [ko ? '화장실(집단지성)' : 'Restroom (crowd)', rate(v.restroom)],
    [ko ? '주소' : 'Address', esc(addr)],
  ];

  const stories = cafeStories(row.id)
    .map((s) => (ko ? s.body : (s.body_en || s.body)))
    .filter(Boolean);
  const nearby = nearbyCafes(row);

  const title = ko
    ? `${name} — ${regKo ? regKo + ' ' : ''}카공 카페 (아메리카노 ${price}원, ${d.score}점) | Cafe in Seoul`
    : `${name} — study cafe${regEn ? ' in ' + regEn : ''} (₩${price}, score ${d.score}) | Cafe in Seoul`;
  const desc = ko
    ? `직접 방문한 ${name} 카공 후기. 조용함·콘센트·좌석·아메리카노 가격·영업시간·화장실까지 정리했습니다.`
    : `A first-hand study-cafe review of ${name}: quiet, outlets, seating, americano price, hours and restrooms.`;
  const canonical = `${BASE}${ko ? '' : '/en'}/cafes/${cafeSlug(row)}`;
  const alternates = [
    { hreflang: 'ko', href: `${BASE}/cafes/${cafeSlug(row)}` },
    { hreflang: 'en', href: `${BASE}/en/cafes/${cafeSlug(row)}` },
    { hreflang: 'x-default', href: `${BASE}/cafes/${cafeSlug(row)}` },
  ];

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'CafeOrCoffeeShop',
    '@id': canonical,
    name,
    url: canonical,
    image: photos.slice(0, 6).map(absImg).filter(Boolean),
    address: { '@type': 'PostalAddress', streetAddress: addr, addressLocality: (ko ? district(row.address) : (districtEn(row.address_en) || district(row.address))) || regionCity(row, ko) || undefined, addressRegion: regionCity(row, ko) || undefined, addressCountry: 'KR' },
    geo: { '@type': 'GeoCoordinates', latitude: row.lat, longitude: row.lng },
    priceRange: `₩${price}`,
    servesCuisine: 'Coffee',
    openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], opens: row.open_time, closes: row.close_time }],
    sameAs: [row.kakao_url, row.naver_url].filter(Boolean),
  };
  const breadcrumb = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Cafe in Seoul', item: BASE + (ko ? '/' : '/en/cafes') },
      { '@type': 'ListItem', position: 2, name: ko ? '카페' : 'Cafes', item: `${BASE}${ko ? '' : '/en'}/cafes` },
      { '@type': 'ListItem', position: 3, name, item: canonical },
    ],
  };

  const dirHref = ko ? '/cafes' : '/en/cafes';
  const body = `
    <nav class="seo-top"><a href="${ko ? '/' : '/en/cafes'}">Cafe in Seoul</a> <span>›</span> <a href="${dirHref}">${ko ? '카페' : 'Cafes'}</a> <span>›</span> <span>${esc(name)}</span></nav>
    <h1>${esc(name)}</h1>
    <p class="sub">${esc(addr)}${gu ? '' : ''} · <span class="seo-badge">${d.score}<small>${ko ? '카공점수' : 'STUDY'}</small></span></p>
    ${hero ? `<img class="seo-hero" src="${esc(imgPath(hero))}" alt="${esc(name)} ${ko ? '카공 카페 대표 사진' : 'study cafe'}" loading="eager" />` : ''}
    ${mapPreview({ center: { lat: row.lat, lng: row.lng }, z: 15, href: mapCafe(ko, row.id), label: ko ? '카공지도 보러가기' : 'Open the cafe map', pins: [{ lat: row.lat, lng: row.lng, photo: hero, focus: true }, ...nearby.map((c) => ({ lat: c.lat, lng: c.lng, photo: c.photo_url }))] })}
    <p class="seo-lead">${esc(aiSum || lead)}</p>
    ${review ? `<h2>${ko ? '카공 총평' : 'Study verdict'}</h2><p class="seo-lead" style="margin-top:0">${esc(review)}</p>` : ''}
    ${viewNote ? `<h2>${ko ? '뷰' : 'View'}</h2><p>${esc(viewNote)}</p>` : ''}
    <h2>${ko ? '카공 정보' : 'The details'}</h2>
    <ul class="seo-spec">${spec.map(([k, val]) => `<li><b>${esc(k)}</b>${val}</li>`).join('')}</ul>
    ${photos.length > 1 ? `<h2>${ko ? '사진' : 'Photos'}</h2><div class="seo-gallery">${photos.slice(0, 9).map((u, i) => `<img src="${esc(imgPath(u))}" alt="${esc(name)} ${ko ? '사진' : 'photo'} ${i + 1}" loading="lazy" />`).join('')}</div>` : ''}
    ${stories.length ? `<h2>${ko ? '방문 후기' : 'Visitor stories'}</h2>${stories.map((s) => `<blockquote class="seo-story">${esc(s)}</blockquote>`).join('')}` : ''}
    <h2>${ko ? '지도·길찾기' : 'Map & directions'}</h2>
    <p><a class="seo-cta" href="${mapCafe(ko, row.id)}">${ko ? '지도에서 열기' : 'Open in the map'} →</a></p>
    <p class="seo-links">${row.kakao_url ? `<a href="${esc(row.kakao_url)}" rel="noopener nofollow" target="_blank">${ko ? '카카오맵' : 'Kakao Map'}</a>` : ''}${row.naver_url ? `<a href="${esc(row.naver_url)}" rel="noopener nofollow" target="_blank">${ko ? '네이버지도' : 'Naver Map'}</a>` : ''}</p>
    ${nearby.length ? `<h2>${ko ? '가까운 다른 카페' : 'Nearby cafes'}</h2><ul class="seo-dir">${nearby.map((c) => `<li><a href="${ko ? '' : '/en'}/cafes/${cafeSlug(c)}"><img src="${esc(imgPath(c.photo_url))}" alt="${esc(ko ? c.name : (c.name_en || c.name))}" loading="lazy" /><span><span class="n">${esc(ko ? c.name : (c.name_en || c.name))}</span><br><span class="m">${esc(guOf(c, ko) || regionCity(c, ko) || '')}</span></span></a></li>`).join('')}</ul>` : ''}
    ${seoFooter(ko)}`;

  const metaDesc = (aiSum ? aiSum.replace(/\s+/g, ' ') : desc).slice(0, 160);
  return shell({ lang: ko ? 'ko' : 'en', title, desc: metaDesc, canonical, alternates, jsonLd: [ld, breadcrumb], body, ogImage: absImg(hero) });
}

// ---- view-spot page --------------------------------------------------------
function viewPhotos(id) {
  return db.prepare('SELECT url FROM viewspot_photos WHERE viewspot_id=? ORDER BY ord, rowid').all(id).map((r) => r.url);
}
// per-photo credit meta (photographer + camera), ordered like the gallery
function viewPhotoMeta(id) {
  return db.prepare(`SELECT vp.url, u.name AS uploader, vp.camera
    FROM viewspot_photos vp LEFT JOIN users u ON u.id = vp.created_by
    WHERE vp.viewspot_id=? ORDER BY vp.ord, vp.rowid`).all(id);
}
// distinct "photographer (camera)" credits for a spot, in first-seen order
function photoCredits(meta) {
  const seen = new Map();
  for (const m of (meta || [])) {
    if (!m.uploader) continue;
    const key = `${m.uploader}|${m.camera || ''}`;
    if (!seen.has(key)) seen.set(key, { who: m.uploader, cam: m.camera || '' });
  }
  return [...seen.values()];
}
// "촬영: sejun (Olympus OM10 24mm f2.8)" / "Photos by sejun (Olympus OM10 24mm f2.8)"
function creditLine(credits, ko) {
  if (!credits.length) return '';
  const parts = credits.map((c) => (c.cam ? `${c.who} (${c.cam})` : c.who));
  return (ko ? '촬영: ' : 'Photos by ') + parts.join(', ');
}
function viewComments(id) {
  return db.prepare(`SELECT body, body_en FROM viewspot_comments WHERE viewspot_id=? ORDER BY created_at DESC LIMIT 6`).all(id);
}
function nearbyViews(v, n = 6) {
  return db.prepare(`SELECT id,name,name_en,photo_url,lat,lng,
      (lat-?)*(lat-?)+(lng-?)*(lng-?) AS d2 FROM viewspots
     WHERE status='approved' AND id<>? ORDER BY d2 ASC LIMIT ?`).all(v.lat, v.lat, v.lng, v.lng, v.id, n);
}

function renderView(row, lang) {
  const ko = lang !== 'en';
  const name = ko ? row.name : (row.name_en || row.name);
  const photos = viewPhotos(row.id);
  const hero = photos[0] || row.photo_url;
  const comments = viewComments(row.id).map((c) => (ko ? c.body : (c.body_en || c.body))).filter(Boolean);
  const nearby = nearbyViews(row);

  const cityKo = regionCity(row, true);   // from coordinates (view-spots have no address)
  const cityEn = regionCity(row, false);
  // the new one-line description (설명) + who shot it with what (사람, 카메라)
  const description = ko ? (row.description || '') : (row.description_en || row.description || '');
  const meta = viewPhotoMeta(row.id);
  const credit = creditLine(photoCredits(meta), ko);
  const genericLead = ko
    ? `${name}${eunNeun(name)} ${cityKo ? `${cityKo}에 위치한 ` : ''}사진 찍기 좋은 장소입니다. 직접 방문해 촬영한 사진을 모았습니다.`
    : `${name} is a scenic photo spot${cityEn ? ` in ${cityEn}` : ''}. These are photos taken there in person.`;
  const lead = description || genericLead;    // [설명] first; fall back to the generic line
  const title = ko
    ? `${name} — ${cityKo ? cityKo + ' ' : ''}사진 명소 | Cafe in Seoul`
    : `${name} — scenic photo spot${cityEn ? ` in ${cityEn}` : ''} | Cafe in Seoul`;
  // search-bot text = [설명] [장소] [사람, 카메라], concatenated (no LLM needed)
  const place = ko ? (cityKo ? `${cityKo}에 위치한 사진 명소.` : '사진 찍기 좋은 명소.')
                   : (cityEn ? `A scenic photo spot in ${cityEn}.` : 'A scenic photo spot.');
  const desc = [description, place, credit].filter(Boolean).join(' ').slice(0, 200);
  const canonical = `${BASE}${ko ? '' : '/en'}/views/${viewSlug(row)}`;
  const alternates = [
    { hreflang: 'ko', href: `${BASE}/views/${viewSlug(row)}` },
    { hreflang: 'en', href: `${BASE}/en/views/${viewSlug(row)}` },
    { hreflang: 'x-default', href: `${BASE}/views/${viewSlug(row)}` },
  ];
  const ld = {
    '@context': 'https://schema.org', '@type': 'TouristAttraction', '@id': canonical,
    name, url: canonical, description: [lead, credit].filter(Boolean).join(' '),
    image: photos.slice(0, 6).map(absImg).filter(Boolean),
    geo: { '@type': 'GeoCoordinates', latitude: row.lat, longitude: row.lng },
    address: { '@type': 'PostalAddress', addressRegion: (ko ? cityKo : cityEn) || undefined, addressCountry: 'KR' },
  };
  const dirHref = ko ? '/views' : '/en/views';
  const body = `
    <nav class="seo-top"><a href="${ko ? '/' : '/en/views'}">Cafe in Seoul</a> <span>›</span> <a href="${dirHref}">${ko ? '명소' : 'View spots'}</a> <span>›</span> <span>${esc(name)}</span></nav>
    <h1>${esc(name)}</h1>
    <p class="sub">${ko ? `${cityKo ? cityKo + ' ' : ''}사진 명소` : `Scenic photo spot${cityEn ? ` · ${cityEn}` : ''}`}</p>
    ${hero ? `<img class="seo-hero" src="${esc(imgPath(hero))}" alt="${esc(name)} ${ko ? '사진 명소' : 'scenic spot'}" loading="eager" />` : ''}
    ${mapPreview({ center: { lat: row.lat, lng: row.lng }, z: 15, href: mapView(ko, row.id), label: ko ? '지도에서 명소 보기' : 'Open the map', pins: [{ lat: row.lat, lng: row.lng, photo: hero, focus: true }, ...nearby.map((s) => ({ lat: s.lat, lng: s.lng, photo: s.photo_url }))] })}
    <p class="seo-lead">${esc(lead)}</p>
    ${credit ? `<p class="sub">${esc(credit)}</p>` : ''}
    ${photos.length > 1 ? `<h2>${ko ? '사진' : 'Photos'}</h2><div class="seo-gallery">${photos.slice(0, 9).map((u, i) => `<img src="${esc(imgPath(u))}" alt="${esc(name)} ${ko ? '사진' : 'photo'} ${i + 1}" loading="lazy" />`).join('')}</div>` : ''}
    ${comments.length ? `<h2>${ko ? '방문 코멘트' : 'Comments'}</h2>${comments.map((c) => `<blockquote class="seo-story">${esc(c)}</blockquote>`).join('')}` : ''}
    <h2>${ko ? '지도' : 'Map'}</h2>
    <p><a class="seo-cta" href="${mapView(ko, row.id)}">${ko ? '지도에서 열기' : 'Open in the map'} →</a></p>
    ${nearby.length ? `<h2>${ko ? '가까운 다른 명소' : 'Nearby spots'}</h2><ul class="seo-dir">${nearby.map((s) => `<li><a href="${ko ? '' : '/en'}/views/${viewSlug(s)}"><img src="${esc(imgPath(s.photo_url))}" alt="${esc(ko ? s.name : (s.name_en || s.name))}" loading="lazy" /><span class="n">${esc(ko ? s.name : (s.name_en || s.name))}</span></a></li>`).join('')}</ul>` : ''}
    ${seoFooter(ko)}`;
  return shell({ lang: ko ? 'ko' : 'en', title, desc, canonical, alternates, jsonLd: [ld], body, ogImage: absImg(hero) });
}

// ---- collection (search-intent) pages -------------------------------------
// /cafes/<key> + /en/cafes/<key>. The per-cafe pages already rank; what was
// missing is a page that answers a BROAD query ("서울 늦게까지 하는 카페",
// "best cafes to work in Seoul"). Each collection is a curated view over the
// SAME first-hand dataset — a lead, a comparison table, a ranked list with real
// photos + verdicts, and the selection criteria. Only genuinely-searched intents
// are promoted to a URL (no faceted-nav explosion); the cafe-detail slug can't
// collide because it always ends in -<8hex>.
const DISPLAY = 20; // cap on how many cafes a collection shows

const toMin = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? (+m[1]) * 60 + +m[2] : null; };
const is24h = (c) => { const o = toMin(c.open_time), cl = toMin(c.close_time); return o != null && cl != null && o === cl; };
const closesLabel = (c, ko) => (is24h(c) ? (ko ? '24시간' : '24h') : (c.close_time || '—'));
// small thumbnail for cards/tables (matches the frontend thumb convention); external CDN stays full
const thumbPath = (u) => { const p = imgPath(u); return p && p.startsWith('/uploads/') ? p.replace(/\.[a-zA-Z]+$/, '_thumb.jpg') : p; };
// first ~2 sentences of a review, for the ranked-card blurb
function clip(text, maxSent = 2, maxChars = 170) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  const parts = t.split(/(?<=[.!?。])\s/);
  let out = '', n = 0;
  for (const p of parts) { if (n >= maxSent) break; if (out && (out + ' ' + p).length > maxChars) break; out += (out ? ' ' : '') + p; n++; }
  if (out.length > maxChars) out = out.slice(0, maxChars - 1).trim() + '…';
  return out;
}

// all 25 Seoul districts → { slug, en }. Stable romanization, independent of
// per-row address_en translation quality.
const SEOUL_GU = {
  강남구: { slug: 'gangnam', en: 'Gangnam' }, 강동구: { slug: 'gangdong', en: 'Gangdong' }, 강북구: { slug: 'gangbuk', en: 'Gangbuk' },
  강서구: { slug: 'gangseo', en: 'Gangseo' }, 관악구: { slug: 'gwanak', en: 'Gwanak' }, 광진구: { slug: 'gwangjin', en: 'Gwangjin' },
  구로구: { slug: 'guro', en: 'Guro' }, 금천구: { slug: 'geumcheon', en: 'Geumcheon' }, 노원구: { slug: 'nowon', en: 'Nowon' },
  도봉구: { slug: 'dobong', en: 'Dobong' }, 동대문구: { slug: 'dongdaemun', en: 'Dongdaemun' }, 동작구: { slug: 'dongjak', en: 'Dongjak' },
  마포구: { slug: 'mapo', en: 'Mapo' }, 서대문구: { slug: 'seodaemun', en: 'Seodaemun' }, 서초구: { slug: 'seocho', en: 'Seocho' },
  성동구: { slug: 'seongdong', en: 'Seongdong' }, 성북구: { slug: 'seongbuk', en: 'Seongbuk' }, 송파구: { slug: 'songpa', en: 'Songpa' },
  양천구: { slug: 'yangcheon', en: 'Yangcheon' }, 영등포구: { slug: 'yeongdeungpo', en: 'Yeongdeungpo' }, 용산구: { slug: 'yongsan', en: 'Yongsan' },
  은평구: { slug: 'eunpyeong', en: 'Eunpyeong' }, 종로구: { slug: 'jongno', en: 'Jongno' }, 중구: { slug: 'jung', en: 'Jung' }, 중랑구: { slug: 'jungnang', en: 'Jungnang' },
};
const GU_BY_SLUG = Object.fromEntries(Object.entries(SEOUL_GU).map(([ko, v]) => [v.slug, { ko, en: v.en }]));
const HOOD_MIN = 4; // a neighborhood needs at least this many cafes to earn its own page

function allCafesDecorated() {
  return db.prepare(`SELECT * FROM cafes WHERE status='approved'`).all().map(decorate);
}
const byScore = (a, b) => b.score - a.score || String(a.name || '').localeCompare(b.name || '');
const quietOf = (c) => (c.votes && c.votes.averages && c.votes.averages.quiet != null ? c.votes.averages.quiet : -1);
// Every collection page targets a "서울 …" query, so it must be Seoul-only. Non-Seoul
// cafes (경주·부산·횡성 등) still get individual pages — just not these city lists. Also
// keeps a shared district name (부산 중구 vs 서울 중구) from leaking across neighborhoods.
const isSeoul = (c) => /^\s*서울/.test(c.address || '');

// attribute collections (array order = hub display order)
const ATTR_COLLECTIONS = [
  { key: 'best-study-cafes-seoul', filter: () => true, sort: byScore,
    query: { ko: '서울 카공하기 좋은 카페', en: 'Best cafes to work in Seoul' },
    h1: { ko: '서울 카공하기 좋은 카페', en: 'Best cafes to work in Seoul' },
    lead: { ko: '직접 방문한 서울 카페 중 카공 적합도가 가장 높은 곳을 골랐습니다. 콘센트, 조용함, 좌석 크기, 아메리카노 가격, 영업시간을 같은 기준으로 평가해 점수를 매겼습니다.',
      en: 'The most laptop-friendly cafes among the Seoul spots I visited in person — each rated on the same rubric: outlets, quiet, seating, americano price and hours.' },
    criteria: { ko: ['직접 방문한 카페만 포함', '카공 점수(가격·콘센트·좌석·조용함) 순 정렬', '조용함은 방문자 투표 반영'],
      en: ['Only cafes visited in person', 'Ranked by study score (price, outlets, seating, quiet)', 'Quiet reflects visitor votes'] } },
  { key: 'late-night', filter: (c) => opensLate(c.open_time, c.close_time), sort: byScore,
    query: { ko: '서울 늦게까지 하는 카페', en: 'Late-night cafes in Seoul' },
    h1: { ko: '서울 늦게까지 카공하기 좋은 카페', en: 'Late-night cafes to work in Seoul' },
    lead: { ko: '밤 10시 이후에도 영업해 늦게까지 작업하기 좋은 카페입니다. 마감 시간, 콘센트, 조용함을 함께 비교했습니다.',
      en: 'Cafes open past 10pm, good for working late. Compared by closing time, outlets and quiet.' },
    criteria: { ko: ['밤 22시 이후 마감(또는 24시간)', '노트북 작업 가능', '콘센트·조용함 비교'],
      en: ['Closes 10pm or later (or 24h)', 'Laptop-friendly', 'Compared on outlets and quiet'] },
    blurb: (c, ko) => (ko ? `밤 ${closesLabel(c, true)}까지 영업합니다.` : `Open until ${closesLabel(c, false)}.`) },
  { key: '24-hour', filter: (c) => is24h(c), sort: byScore,
    query: { ko: '서울 24시간 카페', en: '24-hour cafes in Seoul' },
    h1: { ko: '서울 24시간 카페', en: '24-hour cafes in Seoul' },
    lead: { ko: '24시간 영업하는 카페입니다. 밤샘 작업이나 새벽 공부에 좋은 곳을 직접 확인해 정리했습니다.',
      en: 'Cafes open 24 hours — checked in person, good for all-nighters and early-morning study.' },
    criteria: { ko: ['24시간 영업', '직접 방문 확인', '콘센트·좌석 비교'], en: ['Open 24 hours', 'Verified in person', 'Compared on outlets and seating'] },
    blurb: (c, ko) => (ko ? '24시간 영업합니다.' : 'Open 24 hours.') },
  { key: 'great-view', filter: (c) => c.has_view, sort: byScore,
    query: { ko: '서울 뷰 좋은 카페', en: 'Cafes with great views in Seoul' },
    h1: { ko: '서울 뷰 좋은 카페', en: 'Cafes with a great view in Seoul' },
    lead: { ko: '창밖 뷰가 좋아 작업하며 기분 전환하기 좋은 카페입니다. 직접 방문해 뷰를 확인했습니다.',
      en: 'Cafes with a genuinely good view from the window — checked in person.' },
    criteria: { ko: ['창밖/전망 뷰 있음', '직접 방문 확인', '카공 적합도 함께 평가'], en: ['Has a real window/skyline view', 'Verified in person', 'Also rated for studying'] },
    blurb: (c, ko) => { const vn = ko ? (c.view_note || '') : (c.view_note_en || c.view_note || ''); return vn || (ko ? '창밖 뷰가 좋습니다.' : 'Good view from the window.'); } },
  { key: 'power-outlets', filter: (c) => c.outlets === 'many', sort: byScore,
    query: { ko: '서울 콘센트 많은 카페', en: 'Cafes with power outlets in Seoul' },
    h1: { ko: '서울 콘센트 많은 카페', en: 'Cafes with plenty of outlets in Seoul' },
    lead: { ko: '자리마다 콘센트가 넉넉해 노트북·태블릿 충전 걱정 없이 오래 작업할 수 있는 카페입니다.',
      en: 'Cafes with outlets at most seats — plug in and work for hours without hunting for a socket.' },
    criteria: { ko: ['콘센트 많음(대부분 좌석)', '직접 방문 확인', '좌석·조용함 비교'], en: ['Outlets at most seats', 'Verified in person', 'Compared on seating and quiet'] },
    blurb: (c, ko) => (ko ? '콘센트가 넉넉합니다.' : 'Plenty of power outlets.') },
  { key: 'quiet', filter: (c) => quietOf(c) >= 4, sort: byScore,
    query: { ko: '서울 조용한 카페', en: 'Quiet cafes in Seoul' },
    h1: { ko: '서울 조용한 카공 카페', en: 'Quiet cafes to study in Seoul' },
    lead: { ko: '방문자 투표에서 조용함 4점 이상을 받은 카페입니다. 대화 소음이 적어 집중하기 좋습니다.',
      en: 'Cafes that scored 4+ on quiet in visitor votes — low chatter, easy to focus.' },
    criteria: { ko: ['방문자 조용함 투표 4/5 이상', '집중 작업에 적합', '콘센트·좌석 함께 비교'], en: ['Visitor quiet score 4/5+', 'Good for focused work', 'Compared on outlets and seating'] },
    blurb: (c, ko) => { const q = quietOf(c); return q >= 0 ? (ko ? `조용함 ${q}/5.` : `Quiet ${q}/5.`) : ''; } },
  { key: 'affordable', filter: (c) => +c.iced_americano_price > 0 && +c.iced_americano_price <= 4500, sort: byScore,
    query: { ko: '서울 저렴한 카공 카페', en: 'Cheap cafes to work in Seoul' },
    h1: { ko: '서울 가성비 좋은 저렴한 카공 카페', en: 'Affordable cafes to work in Seoul' },
    lead: { ko: '아이스 아메리카노가 4,500원 이하로 오래 머물기 부담 없는 카페입니다. 가격은 조건일 뿐, 순위는 카공 점수(콘센트·조용함·좌석·가격)로 매겼습니다.',
      en: 'Cafes where an iced americano is ₩4,500 or less — easy on the wallet for a long session. Price is the filter; the ranking is by study score (outlets, quiet, seating, price).' },
    criteria: { ko: ['아이스 아메리카노 4,500원 이하', '오래 머물기 부담 적음', '카공 적합도 함께 평가'], en: ['Iced americano ₩4,500 or under', 'Easy to linger', 'Also rated for studying'] },
    blurb: (c, ko) => (ko ? `아이스 아메리카노 ${won(c.iced_americano_price)}원.` : `Iced americano ₩${won(c.iced_americano_price)}.`) },
  { key: 'spacious', filter: (c) => c.size === 'large', sort: byScore,
    query: { ko: '서울 넓은 대형 카페', en: 'Spacious cafes in Seoul' },
    h1: { ko: '서울 넓은 대형 카공 카페', en: 'Spacious cafes to work in Seoul' },
    lead: { ko: '좌석이 넉넉한 넓은 카페입니다. 자리 잡기 쉽고 옆자리 간격이 여유로워 오래 작업하기 좋습니다.',
      en: 'Large cafes with plenty of seating — easy to grab a spot, with room between tables for a long session.' },
    criteria: { ko: ['좌석 규모 대형', '자리 간격 여유', '콘센트·조용함 비교'], en: ['Large seating capacity', 'Room between tables', 'Compared on outlets and quiet'] } },
];

function hoodCounts() {
  const m = {};
  for (const c of db.prepare(`SELECT address FROM cafes WHERE status='approved'`).all()) {
    if (!isSeoul(c)) continue;               // Seoul 구 only (no 부산/인천 중구 …)
    const g = district(c.address);
    if (g && SEOUL_GU[g]) m[g] = (m[g] || 0) + 1;
  }
  return m;
}
function hoodDef(gu) {
  const info = SEOUL_GU[gu];
  return {
    key: info.slug, kind: 'hood', filter: (c) => isSeoul(c) && district(c.address) === gu, sort: byScore,
    query: { ko: `${gu} 카공 카페`, en: `Best cafes to work in ${info.en}` },
    h1: { ko: `${gu} 카공하기 좋은 카페`, en: `Best cafes to work in ${info.en}` },
    lead: {
      ko: `${gu}에서 직접 방문한 카공 카페입니다. 콘센트, 조용함, 좌석, 아메리카노 가격, 영업시간을 같은 기준으로 비교했습니다.`,
      en: `Study-friendly cafes in ${info.en}, Seoul that I visited in person — compared on outlets, quiet, seating, americano price and hours.`,
    },
    criteria: {
      ko: [`${gu} 소재`, '직접 방문한 카페만 포함', '카공 점수 순 정렬'],
      en: [`Located in ${info.en}`, 'Only cafes visited in person', 'Ranked by study score'],
    },
  };
}
// resolve a slug to a live collection def (attribute or qualifying neighborhood), else null
function getCollection(key) {
  const attr = ATTR_COLLECTIONS.find((d) => d.key === key);
  if (attr) return attr;
  const g = GU_BY_SLUG[key];
  if (g && (hoodCounts()[g.ko] || 0) >= HOOD_MIN) return hoodDef(g.ko);
  return null;
}
// everything currently worth linking/indexing (hub + sitemap)
function listCollections() {
  const hoods = Object.entries(hoodCounts()).filter(([, n]) => n >= HOOD_MIN)
    .sort((a, b) => b[1] - a[1]).map(([gu]) => hoodDef(gu));
  return { attrs: ATTR_COLLECTIONS, hoods };
}

// ---- neighborhood × attribute combos (e.g. 영등포구 뷰 좋은 카페) ----
// Only generated when at least COMBO_MIN cafes match (no thin pages); reachable via
// cross-links + sitemap, not the top-level hub. URL: /cafes/<hood-slug>/<attr-key>.
const COMBO_MIN = 3;
// 'best-study-cafes-seoul' is excluded — crossed with a hood it just == the hood page.
const COMBO_ATTR_KEYS = ['late-night', '24-hour', 'great-view', 'power-outlets', 'quiet', 'affordable', 'spacious'];

function comboDef(gu, attr) {
  const info = SEOUL_GU[gu];
  const subKo = (s) => String(s).replace('서울', gu);
  const subEn = (s) => String(s).replace('Seoul', info.en);
  return {
    key: `${info.slug}/${attr.key}`, kind: 'combo', hoodSlug: info.slug, attrKey: attr.key,
    filter: (c) => isSeoul(c) && district(c.address) === gu && attr.filter(c),
    sort: attr.sort, blurb: attr.blurb,
    query: { ko: subKo(attr.query.ko), en: subEn(attr.query.en) },
    h1: { ko: subKo(attr.h1.ko), en: subEn(attr.h1.en) },
    lead: { ko: `${gu}에서 ${attr.lead.ko}`, en: `${info.en} — ${attr.lead.en}` },
    criteria: { ko: [`${gu} 소재`, ...attr.criteria.ko], en: [`Located in ${info.en}`, ...attr.criteria.en] },
  };
}
// resolve <hood-slug>/<attr-key> to a live combo def (>= COMBO_MIN cafes), else null
function getCombo(hoodSlug, attrKey) {
  const g = GU_BY_SLUG[hoodSlug];
  const attr = ATTR_COLLECTIONS.find((d) => d.key === attrKey);
  if (!g || !attr || !COMBO_ATTR_KEYS.includes(attrKey)) return null;
  if ((hoodCounts()[g.ko] || 0) < HOOD_MIN) return null;   // hood must itself qualify
  const def = comboDef(g.ko, attr);
  if (allCafesDecorated().filter(def.filter).length < COMBO_MIN) return null;
  return def;
}
// all qualifying combos (for sitemap + cross-links)
function listCombos() {
  const base = allCafesDecorated().filter(isSeoul);
  const hoods = Object.entries(hoodCounts()).filter(([, n]) => n >= HOOD_MIN).map(([gu]) => gu);
  const out = [];
  for (const gu of hoods) {
    for (const key of COMBO_ATTR_KEYS) {
      const attr = ATTR_COLLECTIONS.find((d) => d.key === key);
      const def = comboDef(gu, attr);
      if (base.filter(def.filter).length >= COMBO_MIN) out.push(def);
    }
  }
  return out;
}

const COLLECTION_CSS = `
    .seo-cmp-wrap { overflow-x: auto; margin: 8px 0 4px; }
    .seo-cmp { width: 100%; border-collapse: collapse; font-size: 13.5px; }
    .seo-cmp th, .seo-cmp td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--hair); white-space: nowrap; }
    .seo-cmp th { font-size: 11px; text-transform: uppercase; letter-spacing: .3px; color: var(--mute); font-weight: 700; }
    .seo-cmp td.c { font-weight: 700; }   /* name stays on one line (nowrap inherited) — no 1-char wraps */
    .seo-cmp td.c a { text-decoration: none; }
    /* phones: shrink the table and drop the secondary columns (still shown per-cafe in the
       ranked cards below) so 6 columns + long names don't wrap into vertical mush */
    @media (max-width: 600px) {
      .seo-cmp { font-size: 12.5px; }
      .seo-cmp th, .seo-cmp td { padding: 8px 8px; }
      .seo-cmp th:nth-child(n+4), .seo-cmp td:nth-child(n+4) { display: none; }
    }
    .seo-rank { list-style: none; padding: 0; margin: 10px 0 0; display: grid; gap: 14px; }
    .seo-rank > li { display: flex; gap: 13px; padding-bottom: 14px; border-bottom: 1px solid var(--hair); }
    .seo-rank .thumb { flex: none; }
    .seo-rank .thumb img { width: 96px; height: 96px; object-fit: cover; border-radius: var(--r-sm); background: var(--surface-2); display: block; }
    .seo-rank .rk-body { min-width: 0; flex: 1; }
    .seo-rank .rk-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .seo-rank .rk-n { font-family: var(--font-display); font-weight: 800; color: var(--mute); font-size: 15px; }
    .seo-rank .rk-name { font-weight: 800; font-size: 16px; text-decoration: none; }
    .seo-rank .rk-meta { font-size: 12.5px; color: var(--mute); margin: 3px 0 5px; }
    .seo-rank .rk-why { font-size: 14px; line-height: 1.6; color: var(--ink-2); margin: 0 0 6px; }
    .seo-rank .rk-ctas { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    .seo-rank .rk-cta { font-size: 13px; font-weight: 700; text-decoration: none; }
    .seo-rank .rk-cta--sub { color: var(--mute); font-weight: 600; }
    .seo-maphint { font-size: 13px; color: var(--mute); margin: -2px 0 4px; }
    .seo-maphint b { color: var(--ink-2); font-weight: 700; }
    .seo-crit { font-size: 14.5px; line-height: 1.7; padding-left: 20px; margin: 6px 0; }`;

// links back INTO the interactive map. The SPA reads ?lang=en from the URL, so English
// pages carry it; a ?cafe=<id> deep-link lands with that cafe's detail open.
const mapHome = (ko) => (ko ? '/' : '/?lang=en');
const mapCafe = (ko, id) => `/?cafe=${encodeURIComponent(id)}${ko ? '' : '&lang=en'}`;
const mapView = (ko, id) => `/?view=${encodeURIComponent(id)}${ko ? '' : '&lang=en'}`;

function cmpRow(c, ko) {
  const q = quietOf(c);
  const href = `${ko ? '' : '/en'}/cafes/${cafeSlug(c)}`;
  return `<tr><td class="c"><a href="${href}">${esc(ko ? c.name : (c.name_en || c.name))}</a></td>`
    + `<td>${c.score}</td><td>₩${won(c.iced_americano_price)}</td><td>${esc(closesLabel(c, ko))}</td>`
    + `<td>${(OUTLET_N[c.outlets] || OUTLET_N.some)[ko ? 0 : 1]}</td><td>${q >= 0 ? q + '/5' : '—'}</td></tr>`;
}
function rankCard(c, i, def, ko) {
  const nm = ko ? c.name : (c.name_en || c.name);
  const href = `${ko ? '' : '/en'}/cafes/${cafeSlug(c)}`;
  const prose = ko ? (c.ai_summary || c.study_review || '') : (c.ai_summary_en || c.ai_summary || c.study_review_en || c.study_review || '');
  const why = [def.blurb ? def.blurb(c, ko) : '', clip(prose, 2, 170)].filter(Boolean).join(' ');
  const gu = guOf(c, ko) || regionCity(c, ko) || '';
  return `<li>
      <a class="thumb" href="${href}"><img src="${esc(thumbPath(c.photo_url))}" alt="${esc(nm)}" loading="lazy" /></a>
      <div class="rk-body">
        <div class="rk-head"><span class="rk-n">${i + 1}</span><a class="rk-name" href="${href}">${esc(nm)}</a><span class="seo-badge">${c.score}<small>${ko ? '카공' : 'STUDY'}</small></span></div>
        <div class="rk-meta">${esc(gu)} · ₩${won(c.iced_americano_price)} · ${esc(closesLabel(c, ko))}${ko ? ' 마감' : ''} · ${(OUTLET_N[c.outlets] || OUTLET_N.some)[ko ? 0 : 1]}${ko ? ' 콘센트' : ' outlets'}</div>
        ${why ? `<p class="rk-why">${esc(why)}</p>` : ''}
        <span class="rk-ctas"><a class="rk-cta" href="${mapCafe(ko, c.id)}">${ko ? '지도에서 보기' : 'On the map'} →</a><a class="rk-cta rk-cta--sub" href="${href}">${ko ? '자세히' : 'Details'}</a></span>
      </div>
    </li>`;
}

function renderCollection(def, lang) {
  const ko = lang !== 'en';
  const base = allCafesDecorated().filter(isSeoul);   // Seoul-only universe for every list
  const total = base.length;
  const rows = base.filter(def.filter).sort(def.sort);
  const n = rows.length;
  const shown = rows.slice(0, DISPLAY);
  const hero = shown[0] ? shown[0].photo_url : null;
  // map-preview pins: the shown cafes, centered on the #1 (top-score) cafe, which is surfaced
  const pvPins = shown.filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng));
  const h1 = def.h1[ko ? 'ko' : 'en'];
  const lead = def.lead[ko ? 'ko' : 'en'];
  const crit = def.criteria[ko ? 'ko' : 'en'];
  const path = `/cafes/${def.key}`;
  const canonical = `${BASE}${ko ? '' : '/en'}${path}`;
  const alternates = [
    { hreflang: 'ko', href: `${BASE}${path}` },
    { hreflang: 'en', href: `${BASE}/en${path}` },
    { hreflang: 'x-default', href: `${BASE}${path}` },
  ];
  const title = ko ? `${h1} ${n}곳 | Cafe in Seoul` : `${h1} (${n}) | Cafe in Seoul`;
  const desc = String(lead).slice(0, 155);

  const { attrs, hoods } = listCollections();
  const relLinks = [...attrs, ...hoods].filter((d) => d.key !== def.key).slice(0, 12)
    .map((d) => `<a href="${ko ? '' : '/en'}/cafes/${d.key}">${esc(d.query[ko ? 'ko' : 'en'])}</a>`).join('');
  // neighborhood × attribute combos relevant to THIS page (discoverable, not in the hub)
  const allCombos = listCombos();
  let comboRel;
  if (def.kind === 'hood') comboRel = allCombos.filter((d) => d.hoodSlug === def.key);
  else if (def.kind === 'combo') comboRel = allCombos.filter((d) => d.key !== def.key && (d.hoodSlug === def.hoodSlug || d.attrKey === def.attrKey));
  else comboRel = allCombos.filter((d) => d.attrKey === def.key); // attribute page → its neighborhood variants
  const comboLinks = comboRel.slice(0, 16)
    .map((d) => `<a href="${ko ? '' : '/en'}/cafes/${d.key}">${esc(d.query[ko ? 'ko' : 'en'])}</a>`).join('');

  const ld = [
    { '@context': 'https://schema.org', '@type': 'CollectionPage', '@id': canonical, url: canonical,
      name: h1, description: lead, inLanguage: ko ? 'ko' : 'en',
      isPartOf: { '@type': 'WebSite', name: 'Cafe in Seoul', url: BASE + '/' },
      mainEntity: { '@type': 'ItemList', numberOfItems: n,
        itemListElement: shown.map((c, i) => ({ '@type': 'ListItem', position: i + 1, url: `${BASE}${ko ? '' : '/en'}/cafes/${cafeSlug(c)}`, name: ko ? c.name : (c.name_en || c.name) })) } },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Cafe in Seoul', item: BASE + (ko ? '/' : '/en/cafes') },
        { '@type': 'ListItem', position: 2, name: ko ? '카페' : 'Cafes', item: `${BASE}${ko ? '' : '/en'}/cafes` },
        { '@type': 'ListItem', position: 3, name: h1, item: canonical },
      ] },
  ];

  const body = `
    <nav class="seo-top"><a href="${ko ? '/' : '/en/cafes'}">Cafe in Seoul</a> <span>›</span> <a href="${ko ? '/cafes' : '/en/cafes'}">${ko ? '카페' : 'Cafes'}</a> <span>›</span> <span>${esc(h1)}</span></nav>
    <h1>${esc(ko ? `${h1} ${n}곳` : h1)}</h1>
    <p class="sub">${ko ? `직접 방문한 ${total}개 카페 중에서` : `From ${total} cafes visited in person`}</p>
    ${hero ? `<img class="seo-hero" src="${esc(imgPath(hero))}" alt="${esc(h1)}" loading="eager" />` : ''}
    ${pvPins.length ? mapPreview({ center: { lat: pvPins[0].lat, lng: pvPins[0].lng }, z: 13, href: mapHome(ko), label: ko ? '카공지도 보러가기' : 'Open the cafe map', pins: pvPins.map((c, i) => ({ lat: c.lat, lng: c.lng, photo: c.photo_url, focus: i === 0 })) }) : ''}
    <p class="seo-lead">${esc(lead)}</p>
    ${n ? `<h2>${ko ? '비교표' : 'At a glance'}</h2>
    <div class="seo-cmp-wrap"><table class="seo-cmp"><thead><tr><th>${ko ? '카페' : 'Cafe'}</th><th>${ko ? '점수' : 'Score'}</th><th>${ko ? '아메리카노' : 'Americano'}</th><th>${ko ? '마감' : 'Closes'}</th><th>${ko ? '콘센트' : 'Outlets'}</th><th>${ko ? '조용함' : 'Quiet'}</th></tr></thead><tbody>${shown.map((c) => cmpRow(c, ko)).join('')}</tbody></table></div>
    <h2>${ko ? '추천 카페' : 'The cafes'}</h2><ol class="seo-rank">${shown.map((c, i) => rankCard(c, i, def, ko)).join('')}</ol>` : `<p class="seo-lead">${ko ? '아직 조건에 맞는 카페가 없습니다.' : 'No cafes match this yet.'}</p>`}
    ${n > DISPLAY ? `<p class="seo-links"><a href="${ko ? '/cafes' : '/en/cafes'}">${ko ? `카페 전체 ${total}곳 보기` : `See all ${total} cafes`} →</a></p>` : ''}
    <h2>${ko ? '선정 기준' : 'How these were chosen'}</h2>
    <ul class="seo-crit">${crit.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <h2>${ko ? '다른 조건·지역으로 보기' : 'Browse by intent or area'}</h2>
    <div class="seo-links">${relLinks}</div>
    ${comboLinks ? `<h2>${ko ? '지역 × 조건' : 'Area × filter'}</h2><div class="seo-links">${comboLinks}</div>` : ''}
    ${seoFooter(ko)}`;

  return shell({ lang: ko ? 'ko' : 'en', title, desc, canonical, alternates, jsonLd: ld, body, ogImage: absImg(hero), extraCss: COLLECTION_CSS });
}

// ---- directories -----------------------------------------------------------
function seoFooter(ko) {
  return `<footer class="seo-foot">
    <a href="${ko ? '/' : '/en/cafes'}">${ko ? '지도 홈' : 'Map home'}</a>
    <a href="${ko ? '/cafes' : '/en/cafes'}">${ko ? '카페 전체' : 'All cafes'}</a>
    <a href="${ko ? '/views' : '/en/views'}">${ko ? '명소 전체' : 'All view spots'}</a>
    <a href="${ko ? '/en/cafes' : '/cafes'}">${ko ? 'English' : '한국어'}</a>
  </footer>`;
}

function renderCafeDirectory(lang) {
  const ko = lang !== 'en';
  const rows = db.prepare(`SELECT * FROM cafes WHERE status='approved' ORDER BY name`).all();
  const items = rows.map((c) => {
    const d = decorate(c);
    const nm = ko ? c.name : (c.name_en || c.name);
    return `<li><a href="${ko ? '' : '/en'}/cafes/${cafeSlug(c)}"><img src="${esc(imgPath(c.photo_url))}" alt="${esc(nm)}" loading="lazy" /><span><span class="n">${esc(nm)}</span><br><span class="m">${esc(guOf(c, ko) || regionCity(c, ko) || '')} · ${d.score}${ko ? '점' : ''}</span></span></a></li>`;
  }).join('');
  const title = ko ? `서울 카공 카페 전체 목록 (${rows.length}곳) | Cafe in Seoul` : `All study cafes in Seoul (${rows.length}) | Cafe in Seoul`;
  const desc = ko ? '직접 방문한 서울 카공 카페 전체 목록. 조용함·콘센트·좌석·가격 기준으로 정리했습니다.' : 'Every study-friendly cafe in Seoul we visited in person, ranked on quiet, outlets, seating and price.';
  const canonical = `${BASE}${ko ? '' : '/en'}/cafes`;
  const { attrs, hoods } = listCollections();
  const link = (d) => `<a href="${ko ? '' : '/en'}/cafes/${d.key}">${esc(d.query[ko ? 'ko' : 'en'])}</a>`;
  const attrLinks = attrs.map(link).join('');
  const hoodLinks = hoods.map(link).join('');
  const pv = rows.filter((c) => isSeoul(c) && Number.isFinite(c.lat) && Number.isFinite(c.lng));
  const pvLat = pv.length ? pv.reduce((a, c) => a + c.lat, 0) / pv.length : null;
  const pvLng = pv.length ? pv.reduce((a, c) => a + c.lng, 0) / pv.length : null;
  const body = `
    <nav class="seo-top"><a href="${ko ? '/' : '/en/cafes'}">Cafe in Seoul</a> <span>›</span> <span>${ko ? '카페' : 'Cafes'}</span></nav>
    <h1>${ko ? '서울 카공 카페' : 'Study cafes in Seoul'}</h1>
    <p class="seo-lead">${ko ? `직접 방문한 카공 카페 ${rows.length}곳입니다. 각 카페의 조용함, 콘센트, 좌석, 아메리카노 가격, 영업시간을 확인했습니다.` : `${rows.length} study-friendly cafes we visited in person — checking quiet, outlets, seating, americano price and hours at each one.`}</p>
    ${pv.length ? mapPreview({ center: { lat: pvLat, lng: pvLng }, z: 11, href: mapHome(ko), label: ko ? '카공지도 보러가기' : 'Open the cafe map', pins: pv.slice(0, 18).map((c) => ({ lat: c.lat, lng: c.lng, photo: c.photo_url })) }) : ''}
    <h2>${ko ? '조건별 카페' : 'By what you need'}</h2>
    <div class="seo-links">${attrLinks}</div>
    ${hoodLinks ? `<h2>${ko ? '지역별 카페' : 'By neighborhood'}</h2><div class="seo-links">${hoodLinks}</div>` : ''}
    <p class="seo-links"><a href="${ko ? '/views' : '/en/views'}">${ko ? '사진 명소 모음 보기' : 'Browse scenic photo spots'} →</a></p>
    <h2>${ko ? '전체 목록' : 'Full list'}</h2>
    <ul class="seo-dir">${items}</ul>
    ${seoFooter(ko)}`;
  return shell({
    lang: ko ? 'ko' : 'en', title, desc, canonical,
    alternates: [{ hreflang: 'ko', href: `${BASE}/cafes` }, { hreflang: 'en', href: `${BASE}/en/cafes` }, { hreflang: 'x-default', href: `${BASE}/cafes` }],
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'ItemList', numberOfItems: rows.length, itemListElement: rows.map((c, i) => ({ '@type': 'ListItem', position: i + 1, url: `${BASE}${ko ? '' : '/en'}/cafes/${cafeSlug(c)}`, name: ko ? c.name : (c.name_en || c.name) })) }],
    body,
  });
}

function renderViewDirectory(lang) {
  const ko = lang !== 'en';
  const rows = db.prepare(`SELECT * FROM viewspots WHERE status='approved' ORDER BY name`).all();
  const items = rows.map((v) => {
    const nm = ko ? v.name : (v.name_en || v.name);
    const sub = (ko ? v.description : (v.description_en || v.description)) || regionCity(v, ko) || '';
    return `<li><a href="${ko ? '' : '/en'}/views/${viewSlug(v)}"><img src="${esc(imgPath(v.photo_url))}" alt="${esc(nm)}" loading="lazy" /><span><span class="n">${esc(nm)}</span>${sub ? `<br><span class="m">${esc(clip(sub, 1, 60))}</span>` : ''}</span></a></li>`;
  }).join('');
  const title = ko ? `서울 사진 명소 전체 목록 (${rows.length}곳) | Cafe in Seoul` : `All scenic photo spots in Seoul (${rows.length}) | Cafe in Seoul`;
  const desc = ko ? '서울에서 사진 찍기 좋은 명소 전체 목록. 직접 방문해 촬영했습니다.' : 'Every scenic photo spot in Seoul on Cafe in Seoul, shot in person.';
  const canonical = `${BASE}${ko ? '' : '/en'}/views`;
  // Center on the Seoul cluster (where the density is), NOT the centroid of everything —
  // Busan + Seoul points average out to an empty spot near Yongin. Non-Seoul spots just
  // fall outside the preview frame; the panel is a "taste", not the full index.
  const pvAll = rows.filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng));
  const pv = (pvAll.filter((v) => /^\s*서울/.test(v.region || '')) .length ? pvAll.filter((v) => /^\s*서울/.test(v.region || '')) : pvAll);
  const pvLat = pv.length ? pv.reduce((a, v) => a + v.lat, 0) / pv.length : null;
  const pvLng = pv.length ? pv.reduce((a, v) => a + v.lng, 0) / pv.length : null;
  const body = `
    <nav class="seo-top"><a href="${ko ? '/' : '/en/views'}">Cafe in Seoul</a> <span>›</span> <span>${ko ? '명소' : 'View spots'}</span></nav>
    <h1>${ko ? '서울 사진 명소' : 'Scenic photo spots in Seoul'}</h1>
    <p class="seo-lead">${ko ? `직접 방문해 촬영한 서울 사진 명소 ${rows.length}곳입니다.` : `${rows.length} scenic spots in Seoul, each shot in person.`}</p>
    ${pv.length ? mapPreview({ center: { lat: pvLat, lng: pvLng }, z: 11, href: mapHome(ko), label: ko ? '지도에서 명소 보기' : 'Open the map', pins: pv.slice(0, 18).map((v) => ({ lat: v.lat, lng: v.lng, photo: v.photo_url })) }) : ''}
    <p class="seo-links"><a href="${ko ? '/cafes' : '/en/cafes'}">${ko ? '카공 카페 모음 보기' : 'Browse study cafes'} →</a></p>
    <ul class="seo-dir">${items}</ul>
    ${seoFooter(ko)}`;
  return shell({
    lang: ko ? 'ko' : 'en', title, desc, canonical,
    alternates: [{ hreflang: 'ko', href: `${BASE}/views` }, { hreflang: 'en', href: `${BASE}/en/views` }, { hreflang: 'x-default', href: `${BASE}/views` }],
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'ItemList', numberOfItems: rows.length, itemListElement: rows.map((v, i) => ({ '@type': 'ListItem', position: i + 1, url: `${BASE}${ko ? '' : '/en'}/views/${viewSlug(v)}`, name: ko ? v.name : (v.name_en || v.name) })) }],
    body,
  });
}

// ---- sitemap + robots ------------------------------------------------------
function sitemap() {
  const cafes = db.prepare(`SELECT * FROM cafes WHERE status='approved'`).all();
  const views = db.prepare(`SELECT * FROM viewspots WHERE status='approved'`).all();
  const NS = 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:xhtml="http://www.w3.org/1999/xhtml"';
  const lastmod = (t) => (t ? String(t).slice(0, 10) : undefined);

  // one <url> with ko/en hreflang alternates + the hero image
  const urlEntry = (koLoc, enLoc, img, mod) => `  <url>
    <loc>${esc(koLoc)}</loc>${mod ? `\n    <lastmod>${mod}</lastmod>` : ''}
    <xhtml:link rel="alternate" hreflang="ko" href="${esc(koLoc)}"/>
    <xhtml:link rel="alternate" hreflang="en" href="${esc(enLoc)}"/>${img ? `\n    <image:image><image:loc>${esc(img)}</image:loc></image:image>` : ''}
  </url>`;

  const staticUrls = [`${BASE}/`, `${BASE}/cafes`, `${BASE}/views`, `${BASE}/en/cafes`, `${BASE}/en/views`]
    .map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n');
  const cafeUrls = cafes.map((c) => urlEntry(`${BASE}/cafes/${cafeSlug(c)}`, `${BASE}/en/cafes/${cafeSlug(c)}`, absImg(c.photo_url), lastmod(c.created_at))).join('\n');
  const viewUrls = views.map((v) => urlEntry(`${BASE}/views/${viewSlug(v)}`, `${BASE}/en/views/${viewSlug(v)}`, absImg(v.photo_url), lastmod(v.created_at))).join('\n');
  // search-intent collection pages (attribute + qualifying neighborhoods), ko/en
  const { attrs, hoods } = listCollections();
  const collUrls = [...attrs, ...hoods].map((d) => urlEntry(`${BASE}/cafes/${d.key}`, `${BASE}/en/cafes/${d.key}`, null, null)).join('\n');
  const comboUrls = listCombos().map((d) => urlEntry(`${BASE}/cafes/${d.key}`, `${BASE}/en/cafes/${d.key}`, null, null)).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset ${NS}>\n${staticUrls}\n${collUrls}\n${comboUrls}\n${cafeUrls}\n${viewUrls}\n</urlset>\n`;
}

const ROBOTS = `User-agent: *
Allow: /

# ChatGPT search
User-agent: OAI-SearchBot
Allow: /

# Perplexity, Google-Extended, etc. are covered by the wildcard above.

Sitemap: ${BASE}/sitemap.xml
`;

// ---- router ----------------------------------------------------------------
const router = express.Router();
const html = (res, s, code = 200, cache = 'public, max-age=300') => res.status(code).type('html').set('Cache-Control', cache).send(s);

// Record a collection/hub visit AND, for real people, persist the session so their
// collection→map journey links up (saveUninitialized:false won't set a cookie otherwise).
// Bots are skipped (no session-store bloat, no cookie). Returns true if this is a human,
// so the caller can serve a private/uncached response (a Set-Cookie must not be shared-cached).
function trackVisit(req, ev) {
  recordEvent(req, ev);
  const human = !isBotUA(req.get('user-agent') || '');
  try { if (human && req.session && !req.session.seen) req.session.seen = 1; } catch { /* ignore */ }
  return human;
}
const collCache = (human) => (human ? 'private, no-store' : 'public, max-age=300');

router.get('/robots.txt', (req, res) => res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(ROBOTS));
router.get('/sitemap.xml', (req, res) => res.type('application/xml').set('Cache-Control', 'public, max-age=1800').send(sitemap()));

// directories
const serveCafeDir = (lang) => (req, res) => {
  const human = trackVisit(req, { type: 'collection', target: 'directory', label: '카페 모음 (전체 목록)' });
  html(res, renderCafeDirectory(lang), 200, collCache(human));
};
router.get('/cafes', serveCafeDir('ko'));
router.get('/en/cafes', serveCafeDir('en'));
router.get('/views', (req, res) => html(res, renderViewDirectory('ko')));
router.get('/en/views', (req, res) => html(res, renderViewDirectory('en')));

// detail pages — redirect to the canonical slug if the name part drifted
function serveCafe(lang) {
  return (req, res, next) => {
    const row = getCafeBySlug(req.params.slug);
    if (!row) return next();
    const want = cafeSlug(row);
    if (req.params.slug !== want) return res.redirect(301, `${lang === 'en' ? '/en' : ''}/cafes/${want}`);
    html(res, renderCafe(row, lang));
  };
}
function serveView(lang) {
  return (req, res, next) => {
    const row = getViewBySlug(req.params.slug);
    if (!row) return next();
    const want = viewSlug(row);
    if (req.params.slug !== want) return res.redirect(301, `${lang === 'en' ? '/en' : ''}/views/${want}`);
    html(res, renderView(row, lang));
  };
}
// collection (search-intent) pages share the /cafes/<slug> shape; they're checked
// first and fall through to the cafe-detail handler when the slug isn't a collection.
function serveCollection(lang) {
  return (req, res, next) => {
    const def = getCollection(req.params.slug);
    if (!def) return next();
    // canonical KST label = the Korean H1, so ko/en hits on the same page group together
    const human = trackVisit(req, { type: 'collection', target: def.key, label: def.h1.ko });
    html(res, renderCollection(def, lang), 200, collCache(human));
  };
}
router.get('/cafes/:slug', serveCollection('ko'));
router.get('/en/cafes/:slug', serveCollection('en'));
router.get('/cafes/:slug', serveCafe('ko'));
router.get('/en/cafes/:slug', serveCafe('en'));
router.get('/views/:slug', serveView('ko'));
router.get('/en/views/:slug', serveView('en'));

// neighborhood × attribute combo pages: /cafes/<hood>/<attr> (404 when < COMBO_MIN)
function serveCombo(lang) {
  return (req, res, next) => {
    const def = getCombo(req.params.hood, req.params.attr);
    if (!def) return next();
    const human = trackVisit(req, { type: 'collection', target: def.key, label: def.h1.ko });
    html(res, renderCollection(def, lang), 200, collCache(human));
  };
}
router.get('/cafes/:hood/:attr', serveCombo('ko'));
router.get('/en/cafes/:hood/:attr', serveCombo('en'));

module.exports = { router, cafeSlug, viewSlug, BASE, regionOf, regionCity, listCollections, getCollection };
