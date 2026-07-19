'use strict';

// Reads a list of cafes (name + Kakao link pairs) from a markdown file and
// enriches each via Kakao (+ AI review summary) into server/seed-data.json.
// Usage:  node server/import-kakao.js [path/to/list.md]   (default: testcafe.md)
//
// List format — name line followed by its Kakao link, blank lines ignored:
//   더한강
//   https://kko.to/c6-1M7T_2c
//
// Discrete 카공 fields (floors/size/outlets/view) are NOT guessed — they get
// neutral defaults for a human/admin to adjust (view is a light name heuristic).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const kakao = require('./kakao');
const ai = require('./ai');

const listPath = process.argv[2] || path.join(__dirname, '..', 'testcafe.md');
const outPath = path.join(__dirname, 'seed-data.json');

const isLink = (s) => /kko\.to|kko\.kakao\.com|place\.map\.kakao|map\.kakao|applink\.map\.kakao/.test(s);

function parseList(text) {
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  const pairs = [];
  let name = null;
  for (const line of lines) {
    if (isLink(line)) { if (name) { pairs.push({ name, url: line }); name = null; } }
    else name = line;
  }
  return pairs;
}

// NOTE: floors / size / outlets / view are NOT inferred — Kakao doesn't provide
// them and guesses are unreliable. They default to neutral for a human to set.

(async () => {
  if (!kakao.HAS_KAKAO) { console.error('KAKAO_API_KEY 미설정 — 중단'); process.exit(1); }
  const pairs = parseList(fs.readFileSync(listPath, 'utf8'));
  console.error(`목록 ${pairs.length}곳 — 가져오는 중...`);

  const out = [];
  for (const { name: label, url } of pairs) {
    try {
      const id = await kakao.resolvePlaceId(url);
      if (!id) { console.error('❌ ID 못찾음:', label, url); continue; }
      const d = await kakao.fetchDetail(id);
      let summary = null;
      try { summary = (await ai.summarize(d))?.summary || null; }
      catch (e) { console.error('  (AI 요약 실패):', label, e.message); }

      out.push({
        name: d.name || label,
        address: d.address,
        lat: d.lat, lng: d.lng,
        photo_url: d.photos[0] || d.roadview,
        photos: d.photos.slice(0, 6),
        floors: 1,
        open_time: d.open_time || '09:00',
        close_time: d.close_time || '22:00',
        hours_json: JSON.stringify(d.weekly || []),
        size: 'medium',
        kakao_url: d.kakao_url,
        kakao_place_id: id,
        naver_url: '',
        iced_americano_price: d.iced_americano_price > 0 ? d.iced_americano_price : 4500,
        has_view: 0,
        view_note: null,
        outlets: 'some',
        review_summary: summary,
      });
      console.error('✅', d.name || label, '| id', id, '|', d.open_time, d.close_time, '| 요약', summary ? 'O' : 'X');
    } catch (e) { console.error('❌ 오류', label, e.message); }
  }

  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.error(`\n→ ${out.length}곳을 server/seed-data.json 에 저장. 'npm run reset' 로 반영.`);
})();
