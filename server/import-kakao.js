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

const viewHeuristic = (text) => (/한강|남산|전망|뷰|숲|루프탑|테라스/.test(text) ? 1 : 0);

// top floor from an address like "...8 1-2층" / "2층" / "지하1층" (best-effort)
function floorsFromAddress(addr) {
  if (!addr) return 1;
  const nums = [...addr.matchAll(/(\d+)\s*층/g)].map((m) => Number(m[1]));
  return nums.length ? Math.max(1, ...nums) : 1;
}
const FRANCHISE = /스타벅스|할리스|투썸|이디야|커피빈|폴바셋|메가커피|메가엠지씨|컴포즈|빽다방|엔제리너스|파스쿠찌|탐앤탐스/;
const sizeHeuristic = (name, floors) => (FRANCHISE.test(name) ? 'large' : (floors >= 2 ? 'medium' : 'medium'));

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

      const floors = floorsFromAddress(d.address);
      out.push({
        name: d.name || label,
        address: d.address,
        lat: d.lat, lng: d.lng,
        photo_url: d.photos[0] || d.roadview,
        floors,
        open_time: d.open_time || '09:00',
        close_time: d.close_time || '22:00',
        size: sizeHeuristic(d.name || label, floors),
        kakao_url: d.kakao_url,
        kakao_place_id: id,
        naver_url: '',
        iced_americano_price: d.iced_americano_price > 0 ? d.iced_americano_price : 4500,
        has_view: viewHeuristic(`${d.name} ${summary || ''}`),
        view_note: null,
        outlets: 'some',
        review_summary: summary,
      });
      console.error('✅', d.name || label, '| id', id, '| floors', floors, '| size', sizeHeuristic(d.name || label, floors), '|', d.open_time, d.close_time, '| 요약', summary ? 'O' : 'X');
    } catch (e) { console.error('❌ 오류', label, e.message); }
  }

  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.error(`\n→ ${out.length}곳을 server/seed-data.json 에 저장. 'npm run reset' 로 반영.`);
})();
