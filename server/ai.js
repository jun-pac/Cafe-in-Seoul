'use strict';

// Summarizes external (Kakao/blog) reviews into a short, study-cafe-focused blurb.
// Intentionally does NOT guess the discrete fields (floors/size/outlets/view) —
// those are entered by a human. Reviews are noisy; we only summarize what's said.
// No-ops (returns null) when OPENAI_API_KEY is absent.

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const HAS_AI = !!OPENAI_API_KEY;

const SYSTEM = `너는 "카공(카페에서 공부/작업)" 관점에서 한국어 카페 리뷰를 요약하는 도우미다.
주어진 리뷰/블로그 텍스트에 실제로 언급된 내용만 사용해라(지어내기 금지). 정보가 적으면 짧게만 써라.
반드시 아래 JSON으로만 답하라:
{
  "summary": "카공 관점 2~3문장 요약(한국어). 분위기/좌석/콘센트/조용함/혼잡도 위주.",
  "keywords": ["짧은 태그", "..."]  // 최대 5개, 예: "조용함", "콘센트 많음", "웨이팅"
}`;

async function summarize(detail) {
  if (!HAS_AI) return null;

  const reviews = (detail.reviews || []).map((r) => `- (${r.star}★) ${r.text}`).join('\n').slice(0, 4000);
  const blogs = (detail.blog_reviews || []).map((b) => `- ${b.title}: ${b.text}`).join('\n').slice(0, 3000);
  const strengths = (detail.strengths || []).map((s) => `${s.name}(${s.count})`).join(', ');
  if (!reviews && !blogs) return null;

  const userMsg = `카페명: ${detail.name}
카테고리: ${detail.category || ''}
평점: ${detail.rating ?? '?'} (리뷰 ${detail.review_count}개)
강점 태그: ${strengths || '없음'}

[카카오 리뷰]
${reviews || '없음'}

[블로그 후기]
${blogs || '없음'}`;

  const payload = JSON.stringify({
    model: MODEL,
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userMsg }],
  });

  // retry transient 429/5xx (OpenAI occasionally returns 500 Internal server error)
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  let r, lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(500 * attempt);
    r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: payload,
    });
    if (r.ok) break;
    lastErr = `HTTP ${r.status}`;
    if (r.status !== 429 && r.status < 500) break; // non-retryable
  }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`OpenAI 오류 (${lastErr}) ${t.slice(0, 160)}`);
  }
  const data = await r.json();
  try {
    return JSON.parse(data.choices?.[0]?.message?.content || '{}');
  } catch {
    return null;
  }
}

// Curation gate: decide whether a submitted cafe belongs in the directory of
// cafes with "확실한 특별함" (clear distinction) for studying. Returns
// { decision:'approve'|'pending', reason, axis }. On no key, returns null so the
// caller falls back to rule-based judgment.
const MOD_SYSTEM = `너는 "카공(카페에서 오래 공부/작업)에 특별히 좋은 카페"만 모으는 큐레이션 심사원이다.
포함(approve) 기준 — 아래 중 최소 하나의 "확실한 특별함"이 있어야 한다:
1) 영업시간이 정말 늦게까지(밤 23시 이후 또는 새벽까지)
2) 규모가 크고 복층이라 눈치 안 보고 오래 있을 수 있음(대형+2층 이상)
3) 뷰가 정말 좋음
제외/보류(pending) 기준:
- 특별할 것 없는 평범한 프랜차이즈 매장
- 카공하기엔 너무 작은 개인 카페
- 정보가 부실하거나 서로 상충(실존 의심)
확실치 않으면 pending. 반드시 아래 JSON만:
{ "decision":"approve"|"pending", "reason":"한국어 한 문장", "axis":"late"|"scale"|"view"|null }`;

async function moderate(cafe) {
  if (!HAS_AI) return null;
  const info = `이름: ${cafe.name}
카테고리/체인 여부: ${cafe.category || cafe.name}
영업: ${cafe.open_time} ~ ${cafe.close_time}
층수: ${cafe.floors} / 면적: ${cafe.size} / 콘센트: ${cafe.outlets} / 뷰: ${cafe.has_view ? '있음' : '없음'}${cafe.view_note ? `(${cafe.view_note})` : ''}
아이스아메리카노: ${cafe.iced_americano_price}원
리뷰요약: ${cafe.review_summary || '없음'}`;

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: MODEL, temperature: 0.1, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: MOD_SYSTEM }, { role: 'user', content: info }],
    }),
  });
  if (!r.ok) throw new Error(`OpenAI 오류 (HTTP ${r.status})`);
  const data = await r.json();
  try { return JSON.parse(data.choices?.[0]?.message?.content || '{}'); }
  catch { return null; }
}

// Drafts a concise "카공 총평" (study-friendliness verdict) an admin then edits.
// The #1 virtue of a study cafe is "감시받지 않는 기분" (not feeling watched), so
// the draft must speak to that. Numeric fields are shown separately, so don't list them.
const STUDY_SYSTEM = `너는 "카공(카페에서 오래 공부/작업)" 관점에서 카페 총평 초안을 쓰는 도우미다.
카공의 제1 덕목은 "감시받지 않는 기분"이다. 아래 정보를 바탕으로 오래 머물며 공부하기에 어떤지 간결하게(2~3문장, 한국어) 초안을 써라.
규칙:
- 반드시 "눈치/감시받는 느낌"을 언급해라 (좌석이 카운터에서 잘 보이는지, 출입이 자유로운지, 공간이 개방적/폐쇄적인지 등 주어진 정보로 추론).
- 층수·면적·콘센트·영업시간·가격 같은 수치는 따로 표시되니 그대로 나열하지 말고, 카공 경험 관점의 총평만 써라.
- 지어내지 말고 주어진 범위에서만. 확실치 않으면 "직접 확인 필요"처럼 여지를 둬라.
- 이건 초안이며 사람이 수정한다. 반드시 아래 JSON만: { "draft": "총평 초안(한국어, 2~3문장)" }`;

async function draftStudyReview(cafe) {
  if (!HAS_AI) return null;
  const info = `이름: ${cafe.name}
층수: ${cafe.floors} / 면적: ${cafe.size} / 콘센트: ${cafe.outlets} / 뷰: ${cafe.has_view ? '있음' : '없음'}${cafe.view_note ? `(${cafe.view_note})` : ''}
영업: ${cafe.open_time} ~ ${cafe.close_time}
아이스아메리카노: ${cafe.iced_americano_price}원
리뷰요약: ${cafe.review_summary || '없음'}`;

  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  let r, lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(500 * attempt);
    r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: MODEL, temperature: 0.5, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: STUDY_SYSTEM }, { role: 'user', content: info }],
      }),
    });
    if (r.ok) break;
    lastErr = `HTTP ${r.status}`;
    if (r.status !== 429 && r.status < 500) break;
  }
  if (!r.ok) throw new Error(`OpenAI 오류 (${lastErr})`);
  const data = await r.json();
  try { return (JSON.parse(data.choices?.[0]?.message?.content || '{}').draft || '').trim() || null; }
  catch { return null; }
}

// Translate an array of Korean strings to natural English in one call. Names → common English
// or clean romanization; sentences → fluent English. Returns a same-length array (null on fail).
async function translateBatch(texts) {
  if (!HAS_AI || !texts.length) return texts.map(() => null);
  const SYSTEM = 'You translate Korean text for a Seoul cafe / photo-spot map app into natural English. '
    + 'For place and cafe names use the common English name if one exists, otherwise a clean romanization '
    + '(e.g. 여의도한강공원 → "Yeouido Hangang Park", 콩카페 → "Kong Cafe", 성수동 → "Seongsu-dong"). '
    + 'For addresses, romanize/translate to a standard English Korean address. For reviews/comments, translate '
    + 'fluently and concisely, preserving tone. Return ONLY a JSON object {"out":[...]} where each array element '
    + 'is a PLAIN STRING (never an object), in the same length and order as the input array.';
  const payload = JSON.stringify({
    model: MODEL, temperature: 0.2, response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify(texts) }],
  });
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  let r, lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(500 * attempt);
    r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: payload,
    });
    if (r.ok) break;
    lastErr = `HTTP ${r.status}`;
    if (r.status !== 429 && r.status < 500) break;
  }
  if (!r.ok) throw new Error(`OpenAI 번역 오류 (${lastErr})`);
  const data = await r.json();
  try {
    const arr = JSON.parse(data.choices?.[0]?.message?.content || '{}').out;
    if (Array.isArray(arr) && arr.length === texts.length) {
      // the model sometimes wraps each item as {field: "translation"} — unwrap to the string
      return arr.map((s) => {
        const v = typeof s === 'string' ? s : (s && typeof s === 'object' ? String(Object.values(s)[0] ?? '') : '');
        return v.trim() ? v.trim() : null;
      });
    }
  } catch { /* fall through */ }
  return texts.map(() => null);
}

module.exports = { summarize, moderate, draftStudyReview, translateBatch, HAS_AI };
