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

module.exports = { summarize, moderate, HAS_AI };
