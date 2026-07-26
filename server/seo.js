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

const BASE = (process.env.BASE_URL || 'https://cafe-in-seoul.com').replace(/\/$/, '');

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

// ---- page chrome -----------------------------------------------------------
// One HTML skeleton for every page. Reuses the site stylesheet so the pages look
// native, plus a little page-specific CSS for the article layout.
function shell({ lang, title, desc, canonical, alternates, jsonLd, body, ogImage }) {
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
    .seo-cta { display: inline-flex; align-items: center; gap: 7px; margin: 8px 0; padding: 11px 18px; border-radius: var(--pill); background: var(--ink); color: #fff; font-weight: 700; text-decoration: none; }
    .seo-links { display: flex; flex-wrap: wrap; gap: 8px; }
    .seo-links a { text-decoration: none; border: 1px solid var(--hair-strong); border-radius: var(--pill); padding: 6px 13px; font-size: 13px; }
    .seo-dir { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
    .seo-dir a { display: flex; gap: 11px; text-decoration: none; align-items: center; }
    .seo-dir img { width: 60px; height: 60px; object-fit: cover; border-radius: var(--r-sm); flex: none; background: var(--surface-2); }
    .seo-dir .n { font-weight: 700; font-size: 14px; }
    .seo-dir .m { font-size: 12px; color: var(--mute); }
    .seo-foot { margin-top: 46px; padding-top: 18px; border-top: 1px solid var(--hair); font-size: 13px; color: var(--mute); display: flex; flex-wrap: wrap; gap: 14px; }
    .seo-foot a { text-decoration: none; }
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
  return db.prepare(`SELECT id,name,name_en,photo_url,address,address_en,
      (lat-?)*(lat-?)+(lng-?)*(lng-?) AS d2 FROM cafes
     WHERE status='approved' AND id<>? ORDER BY d2 ASC LIMIT ?`).all(c.lat, c.lat, c.lng, c.lng, c.id, n);
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
  const photos = cafePhotos(row.id);
  const hero = photos[0] || row.photo_url;

  // natural-language lead, so the crawler (and ChatGPT) sees the key facts as prose
  const lead = ko
    ? `${gu ? `서울 ${gu}` : '서울'}에 있는 ${sizeTxt} 카공 카페입니다. `
      + `아이스 아메리카노는 ${price}원이고 ${row.open_time}–${row.close_time}에 영업합니다. `
      + `${OUTLET_KO[row.outlets] || OUTLET_KO.some}. `
      + (row.floors >= 2 ? `${row.floors}층 규모입니다. ` : '')
      + (hasView ? '창밖 뷰가 좋습니다. ' : '')
      + `Cafe in Seoul 카공 점수는 ${d.score}점입니다.`
    : `A ${sizeTxt} study-friendly cafe in ${gu ? `${gu}, Seoul` : 'Seoul'}. `
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
    ? `${name} — ${gu ? gu + ' ' : ''}카공 카페 (아메리카노 ${price}원, ${d.score}점) | Cafe in Seoul`
    : `${name} — study cafe in ${gu ? gu + ', ' : ''}Seoul (₩${price}, score ${d.score}) | Cafe in Seoul`;
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
    address: { '@type': 'PostalAddress', streetAddress: addr, addressLocality: gu || undefined, addressRegion: ko ? '서울특별시' : 'Seoul', addressCountry: 'KR' },
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
    <p class="seo-lead">${esc(lead)}</p>
    ${review ? `<h2>${ko ? '카공 총평' : 'Study verdict'}</h2><p class="seo-lead" style="margin-top:0">${esc(review)}</p>` : ''}
    ${viewNote ? `<h2>${ko ? '뷰' : 'View'}</h2><p>${esc(viewNote)}</p>` : ''}
    <h2>${ko ? '카공 정보' : 'The details'}</h2>
    <ul class="seo-spec">${spec.map(([k, val]) => `<li><b>${esc(k)}</b>${val}</li>`).join('')}</ul>
    ${photos.length > 1 ? `<h2>${ko ? '사진' : 'Photos'}</h2><div class="seo-gallery">${photos.slice(0, 9).map((u, i) => `<img src="${esc(imgPath(u))}" alt="${esc(name)} ${ko ? '사진' : 'photo'} ${i + 1}" loading="lazy" />`).join('')}</div>` : ''}
    ${stories.length ? `<h2>${ko ? '방문 후기' : 'Visitor stories'}</h2>${stories.map((s) => `<blockquote class="seo-story">${esc(s)}</blockquote>`).join('')}` : ''}
    <h2>${ko ? '지도·길찾기' : 'Map & directions'}</h2>
    <p><a class="seo-cta" href="/?cafe=${esc(row.id)}">${ko ? '지도에서 열기' : 'Open in the map'} →</a></p>
    <p class="seo-links">${row.kakao_url ? `<a href="${esc(row.kakao_url)}" rel="noopener nofollow" target="_blank">${ko ? '카카오맵' : 'Kakao Map'}</a>` : ''}${row.naver_url ? `<a href="${esc(row.naver_url)}" rel="noopener nofollow" target="_blank">${ko ? '네이버지도' : 'Naver Map'}</a>` : ''}</p>
    ${nearby.length ? `<h2>${ko ? '가까운 다른 카페' : 'Nearby cafes'}</h2><ul class="seo-dir">${nearby.map((c) => `<li><a href="${ko ? '' : '/en'}/cafes/${cafeSlug(c)}"><img src="${esc(imgPath(c.photo_url))}" alt="${esc(ko ? c.name : (c.name_en || c.name))}" loading="lazy" /><span><span class="n">${esc(ko ? c.name : (c.name_en || c.name))}</span><br><span class="m">${esc(guOf(c, ko) || 'Seoul')}</span></span></a></li>`).join('')}</ul>` : ''}
    ${seoFooter(ko)}`;

  return shell({ lang: ko ? 'ko' : 'en', title, desc, canonical, alternates, jsonLd: [ld, breadcrumb], body, ogImage: absImg(hero) });
}

// ---- view-spot page --------------------------------------------------------
function viewPhotos(id) {
  return db.prepare('SELECT url FROM viewspot_photos WHERE viewspot_id=? ORDER BY ord, rowid').all(id).map((r) => r.url);
}
function viewComments(id) {
  return db.prepare(`SELECT body, body_en FROM viewspot_comments WHERE viewspot_id=? ORDER BY created_at DESC LIMIT 6`).all(id);
}
function nearbyViews(v, n = 6) {
  return db.prepare(`SELECT id,name,name_en,photo_url,
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

  const lead = ko
    ? `${name}은(는) 서울에서 사진 찍기 좋은 장소입니다. 직접 방문해 촬영한 사진을 모았습니다.`
    : `${name} is a scenic photo spot in Seoul. These are photos taken there in person.`;
  const title = ko ? `${name} — 서울 사진 명소 | Cafe in Seoul` : `${name} — scenic photo spot in Seoul | Cafe in Seoul`;
  const desc = ko
    ? `${name}에서 직접 촬영한 사진과 위치. 서울에서 사진 찍기 좋은 명소를 지도에서 찾아보세요.`
    : `Photos and location of ${name}, a scenic spot in Seoul worth shooting.`;
  const canonical = `${BASE}${ko ? '' : '/en'}/views/${viewSlug(row)}`;
  const alternates = [
    { hreflang: 'ko', href: `${BASE}/views/${viewSlug(row)}` },
    { hreflang: 'en', href: `${BASE}/en/views/${viewSlug(row)}` },
    { hreflang: 'x-default', href: `${BASE}/views/${viewSlug(row)}` },
  ];
  const ld = {
    '@context': 'https://schema.org', '@type': 'TouristAttraction', '@id': canonical,
    name, url: canonical, image: photos.slice(0, 6).map(absImg).filter(Boolean),
    geo: { '@type': 'GeoCoordinates', latitude: row.lat, longitude: row.lng },
    address: { '@type': 'PostalAddress', addressRegion: ko ? '서울특별시' : 'Seoul', addressCountry: 'KR' },
  };
  const dirHref = ko ? '/views' : '/en/views';
  const body = `
    <nav class="seo-top"><a href="${ko ? '/' : '/en/views'}">Cafe in Seoul</a> <span>›</span> <a href="${dirHref}">${ko ? '명소' : 'View spots'}</a> <span>›</span> <span>${esc(name)}</span></nav>
    <h1>${esc(name)}</h1>
    <p class="sub">${ko ? '서울 사진 명소' : 'Scenic photo spot · Seoul'}</p>
    ${hero ? `<img class="seo-hero" src="${esc(imgPath(hero))}" alt="${esc(name)} ${ko ? '사진 명소' : 'scenic spot'}" loading="eager" />` : ''}
    <p class="seo-lead">${esc(lead)}</p>
    ${photos.length > 1 ? `<h2>${ko ? '사진' : 'Photos'}</h2><div class="seo-gallery">${photos.slice(0, 9).map((u, i) => `<img src="${esc(imgPath(u))}" alt="${esc(name)} ${ko ? '사진' : 'photo'} ${i + 1}" loading="lazy" />`).join('')}</div>` : ''}
    ${comments.length ? `<h2>${ko ? '방문 코멘트' : 'Comments'}</h2>${comments.map((c) => `<blockquote class="seo-story">${esc(c)}</blockquote>`).join('')}` : ''}
    <h2>${ko ? '지도' : 'Map'}</h2>
    <p><a class="seo-cta" href="/?view=${esc(row.id)}">${ko ? '지도에서 열기' : 'Open in the map'} →</a></p>
    ${nearby.length ? `<h2>${ko ? '가까운 다른 명소' : 'Nearby spots'}</h2><ul class="seo-dir">${nearby.map((s) => `<li><a href="${ko ? '' : '/en'}/views/${viewSlug(s)}"><img src="${esc(imgPath(s.photo_url))}" alt="${esc(ko ? s.name : (s.name_en || s.name))}" loading="lazy" /><span class="n">${esc(ko ? s.name : (s.name_en || s.name))}</span></a></li>`).join('')}</ul>` : ''}
    ${seoFooter(ko)}`;
  return shell({ lang: ko ? 'ko' : 'en', title, desc, canonical, alternates, jsonLd: [ld], body, ogImage: absImg(hero) });
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
    return `<li><a href="${ko ? '' : '/en'}/cafes/${cafeSlug(c)}"><img src="${esc(imgPath(c.photo_url))}" alt="${esc(nm)}" loading="lazy" /><span><span class="n">${esc(nm)}</span><br><span class="m">${esc(guOf(c, ko) || 'Seoul')} · ${d.score}${ko ? '점' : ''}</span></span></a></li>`;
  }).join('');
  const title = ko ? `서울 카공 카페 전체 목록 (${rows.length}곳) | Cafe in Seoul` : `All study cafes in Seoul (${rows.length}) | Cafe in Seoul`;
  const desc = ko ? '직접 방문한 서울 카공 카페 전체 목록. 조용함·콘센트·좌석·가격 기준으로 정리했습니다.' : 'Every study-friendly cafe in Seoul we visited in person, ranked on quiet, outlets, seating and price.';
  const canonical = `${BASE}${ko ? '' : '/en'}/cafes`;
  const body = `
    <nav class="seo-top"><a href="${ko ? '/' : '/en/cafes'}">Cafe in Seoul</a> <span>›</span> <span>${ko ? '카페' : 'Cafes'}</span></nav>
    <h1>${ko ? '서울 카공 카페' : 'Study cafes in Seoul'}</h1>
    <p class="seo-lead">${ko ? `직접 방문한 카공 카페 ${rows.length}곳입니다. 각 카페의 조용함, 콘센트, 좌석, 아메리카노 가격, 영업시간을 확인했습니다.` : `${rows.length} study-friendly cafes we visited in person — checking quiet, outlets, seating, americano price and hours at each one.`}</p>
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
    return `<li><a href="${ko ? '' : '/en'}/views/${viewSlug(v)}"><img src="${esc(imgPath(v.photo_url))}" alt="${esc(nm)}" loading="lazy" /><span class="n">${esc(nm)}</span></a></li>`;
  }).join('');
  const title = ko ? `서울 사진 명소 전체 목록 (${rows.length}곳) | Cafe in Seoul` : `All scenic photo spots in Seoul (${rows.length}) | Cafe in Seoul`;
  const desc = ko ? '서울에서 사진 찍기 좋은 명소 전체 목록. 직접 방문해 촬영했습니다.' : 'Every scenic photo spot in Seoul on Cafe in Seoul, shot in person.';
  const canonical = `${BASE}${ko ? '' : '/en'}/views`;
  const body = `
    <nav class="seo-top"><a href="${ko ? '/' : '/en/views'}">Cafe in Seoul</a> <span>›</span> <span>${ko ? '명소' : 'View spots'}</span></nav>
    <h1>${ko ? '서울 사진 명소' : 'Scenic photo spots in Seoul'}</h1>
    <p class="seo-lead">${ko ? `직접 방문해 촬영한 서울 사진 명소 ${rows.length}곳입니다.` : `${rows.length} scenic spots in Seoul, each shot in person.`}</p>
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
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset ${NS}>\n${staticUrls}\n${cafeUrls}\n${viewUrls}\n</urlset>\n`;
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
const html = (res, s, code = 200) => res.status(code).type('html').set('Cache-Control', 'public, max-age=300').send(s);

router.get('/robots.txt', (req, res) => res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(ROBOTS));
router.get('/sitemap.xml', (req, res) => res.type('application/xml').set('Cache-Control', 'public, max-age=1800').send(sitemap()));

// directories
router.get('/cafes', (req, res) => html(res, renderCafeDirectory('ko')));
router.get('/en/cafes', (req, res) => html(res, renderCafeDirectory('en')));
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
router.get('/cafes/:slug', serveCafe('ko'));
router.get('/en/cafes/:slug', serveCafe('en'));
router.get('/views/:slug', serveView('ko'));
router.get('/en/views/:slug', serveView('en'));

module.exports = { router, cafeSlug, viewSlug, BASE };
