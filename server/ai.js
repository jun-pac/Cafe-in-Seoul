'use strict';

// Uses an LLM to infer the "soft" discrete fields (floors / size / outlets /
// view) that aren't in structured Kakao data, from review + blog text.
// Returns guesses WITH confidence + evidence so the admin can verify, not trust.
// No-ops (returns null) when OPENAI_API_KEY is absent.

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const HAS_AI = !!OPENAI_API_KEY;

const SYSTEM = `너는 "카공(카페에서 공부/작업)" 디렉토리를 위해 한국어 카페 리뷰에서 정보를 추출하는 도우미다.
주어진 리뷰/블로그/태그 텍스트에서만 근거를 찾아라. 텍스트에 근거가 없으면 반드시 null로 둬라 (추측 금지).
반드시 아래 JSON 스키마로만 답하라:
{
  "summary": "카공 관점 한두 문장 요약(한국어)",
  "multi_floor": true|false|null,        // 2층 이상/복층 언급 있으면 true
  "floors_guess": 정수|null,
  "size": "small"|"medium"|"large"|null, // 좌석/규모 언급 기반. 프랜차이즈 대형=large
  "outlets": "many"|"some"|"few"|"none"|null, // 콘센트 언급 기반
  "has_view": true|false|null,           // 뷰/전망/창가 좋다는 언급
  "view_note": "짧은 뷰 설명"|null,
  "study_fit": 0~100 정수|null,          // 카공 적합성 추정(조용함/오래머물기/콘센트 종합)
  "confidence": { "multi_floor":0~1, "size":0~1, "outlets":0~1, "has_view":0~1 },
  "evidence": { "필드명": "근거가 된 리뷰 문구" }
}`;

async function enrich(detail) {
  if (!HAS_AI) return null;

  const reviews = (detail.reviews || []).map((r) => `- (${r.star}★) ${r.text}`).join('\n').slice(0, 4000);
  const blogs = (detail.blog_reviews || []).map((b) => `- ${b.title}: ${b.text}`).join('\n').slice(0, 3000);
  const strengths = (detail.strengths || []).map((s) => `${s.name}(${s.count})`).join(', ');

  const userMsg = `카페명: ${detail.name}
카테고리: ${detail.category || ''}
평점: ${detail.rating ?? '?'} (리뷰 ${detail.review_count}개)
강점 태그: ${strengths || '없음'}
영업시간(대표): ${detail.open_time || '?'} ~ ${detail.close_time || '?'}

[카카오 리뷰]
${reviews || '없음'}

[블로그 후기]
${blogs || '없음'}`;

  const body = {
    model: MODEL,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userMsg },
    ],
  };

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`OpenAI 오류 (HTTP ${r.status}) ${t.slice(0, 200)}`);
  }
  const data = await r.json();
  const content = data.choices?.[0]?.message?.content || '{}';
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

module.exports = { enrich, HAS_AI };
