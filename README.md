# ☕ 서울 카공 지도 (seoul-cafe)

카공(카페 공부)하기 좋은 서울 카페를 지도에서 찾는 웹앱. 지도 위에 **핀 대신 카페 대표사진 카드**를 띄우고,
줌아웃해서 카드가 겹치면 **종합점수가 가장 높은 카페만 남깁니다**.

## 기능 (요구사항 매핑)

- **미니멀 OSM 지도** — CARTO Positron(light) 래스터 타일. API 키 불필요, 가장 담백한 회색 디자인.
- **사진 카드 마커 + 겹침 제거** — 줌 레벨마다 픽셀 충돌을 계산해, 겹치는 카드 중 종합점수 1등만 남기고 나머지는 숨김. 살아남은 카드에는 `+N` 배지로 흡수한 개수를 표시. (`public/js/declutter.js`)
- **카드 클릭 → 우측 상세 패널** — 사진, 모든 필드, 지도 링크, 투표, 후기.
- **필터** — 다층 여부 · 영업중/늦게까지 · 면적(소/중/대) · 콘센트 수준 · 아메리카노 가격 상한 · 집단지성 평가(조용함/커피맛/화장실) 최소점수.
- **카페 등록 (로그인 필요)** — 대표사진 + 7개 필수 discrete 필드:
  1. 층수(다층 여부) 2. 영업시간 3. 면적 4. 네이버·카카오 지도 링크 5. 아이스 아메리카노 가격 6. 뷰 7. 콘센트 유무
  위치는 지도를 클릭해 지정.
- **집단지성 투표(1–5)** — 커피맛 · 조용함 · 화장실 청결. 사용자당 카테고리별 1표(재투표 시 갱신).
- **후기 + 사진 (로그인 필요)** — 자유 텍스트 + 이미지 업로드.
- **종합점수** — discrete 필드(최대 50) + 투표(최대 50, 조용함 가중치 최고)로 0–100 산출. 카드 겹침 우선순위 = 이 점수. (`server/score.js`)
- **SSO 로그인** — Google Identity Services(GIS). **client ID만 필요(secret 불필요).** 미설정 시 **데모 로그인(닉네임 입력)** 으로 모든 기능 사용 가능.
- **🤖 카카오 + AI 자동 채우기 (관리자)** — 카페 이름을 검색하면 카카오에서 좌표·주소·영업시간·아이스아메리카노 가격·사진을 자동 추출하고, 리뷰를 OpenAI로 분석해 다층/면적/콘센트/뷰를 **근거·신뢰도와 함께 추론**해 등록 폼을 채움. 관리자가 확인·수정 후 저장.

## 빠른 시작

```bash
npm install
npm run seed      # 예시 카페 13곳 + 데모 유저/투표/후기 생성
npm start         # http://localhost:3000
```

- 로그인: Google 미설정 상태이므로 사이드바 **"로그인 (데모)"** → 닉네임 입력.
- `npm run reset` : DB 삭제 후 재시드.

> 예시 카페 사진은 `picsum.photos` 시드 이미지(항상 로드됨)를 씁니다. 실제 등록 시엔 파일 업로드가 `uploads/`에 저장됩니다.

## Google SSO 설정 (GIS — secret 불필요)

Google Identity Services 토큰 방식이라 **client ID만** 있으면 됩니다(비밀키 X).

1. https://console.cloud.google.com/apis/credentials → **웹 애플리케이션** OAuth 클라이언트 생성.
2. **승인된 자바스크립트 원본**에 추가: `http://localhost:3000` (배포 시 `https://seoul-cafe.com`).
   - 리디렉션 URI는 필요 없음(토큰 방식).
3. `.env`:
   ```
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   ADMIN_EMAILS=you@gmail.com      # 비우면 로그인한 모두가 관리자(로컬 편의)
   SESSION_SECRET=<랜덤 문자열>
   ```
`GOOGLE_CLIENT_ID`가 있으면 Google 버튼이 뜨고 데모 로그인은 자동 비활성화됩니다.

## 🤖 카카오 + AI 자동 채우기 (관리자 전용)

관리자로 로그인하면 **카페 등록** 창 상단에 자동 채우기 도구가 생깁니다.

1. 카페 이름 검색 → 카카오 후보 목록.
2. 후보 선택 시:
   - **규칙 기반 추출**(카카오): 이름·주소·좌표·영업시간·아이스아메리카노 가격(메뉴)·대표사진 후보·카카오링크.
   - **AI 추론**(OpenAI): 리뷰/블로그 텍스트에서 다층·면적·콘센트·뷰를 **신뢰도 + 근거 문구**와 함께 추론. 근거 없으면 `null`(추측 안 함).
3. 폼이 자동으로 채워지고, 관리자가 검토·수정 후 저장.

필요 env: `KAKAO_API_KEY`(카카오 REST 키), `OPENAI_API_KEY`(+선택 `OPENAI_MODEL`, 기본 `gpt-4o-mini`).
> 카카오 상세(영업시간/메뉴/리뷰)는 비공식 내부 엔드포인트를 사용하므로 스펙이 바뀌면 조정이 필요할 수 있습니다. 실패해도 공식 검색 API 기반 정보는 채워집니다.

## seoul-cafe.com + Cloudflare Tunnel (도메인 구매 후)

도메인을 사서 Cloudflare에 연결한 뒤:

```bash
# 1) 서버 실행 (예: 3000 포트)
npm start

# 2) cloudflared 설치 후 터널 생성
cloudflared tunnel login
cloudflared tunnel create seoul-cafe
cloudflared tunnel route dns seoul-cafe seoul-cafe.com

# 3) ~/.cloudflared/config.yml
#   tunnel: <TUNNEL_ID>
#   credentials-file: /home/USER/.cloudflared/<TUNNEL_ID>.json
#   ingress:
#     - hostname: seoul-cafe.com
#       service: http://localhost:3000
#     - service: http_status:404

cloudflared tunnel run seoul-cafe
```

그리고 `.env`에서 `BASE_URL=https://seoul-cafe.com` 로 바꾸면 세션 쿠키가 `secure`로 발급되고 OAuth 콜백 URL도 맞춰집니다. (`app.set('trust proxy', 1)` 이미 설정됨.)

## API 요약

| Method | Path | 설명 |
|---|---|---|
| GET  | `/api/cafes` | 목록(점수 포함, 점수순 정렬) |
| GET  | `/api/cafes/:id` | 상세 + 후기 + 내 투표 |
| POST | `/api/cafes` | 등록 (auth, multipart `photo` + 필수 필드) |
| POST | `/api/cafes/:id/vote` | `{category, score}` 투표 (auth) |
| POST | `/api/cafes/:id/reviews` | 후기(multipart, `body` + 선택 `photo`) (auth) |
| GET  | `/api/auth/me` | 로그인 상태/방식 (+ isAdmin) |
| POST | `/api/auth/google/verify` | GIS ID 토큰 검증 로그인 |
| POST | `/api/auth/dev-login` | 데모 로그인 (Google 미설정 시) |
| POST | `/api/auth/logout` | 로그아웃 |
| GET  | `/api/admin/search?q=` | 카카오 카페 검색 (admin) |
| GET  | `/api/admin/prefill/:id` | 카카오 상세 + AI 추론 → 폼 프리필 (admin) |

## 구조

```
server/
  index.js        Express 앱 + 세션 + 정적 서빙
  db.js           SQLite 스키마 (better-sqlite3)
  score.js        종합점수 계산
  cafeModel.js    투표 집계 + 점수 데코레이션
  auth.js         Google GIS 토큰 로그인 + 데모 로그인 + 관리자 판별
  kakao.js        카카오 검색/상세 추출 (영업시간·메뉴·리뷰·사진)
  ai.js           OpenAI 리뷰 분석 → 소프트 필드 추론
  routes/         cafes / votes / reviews / admin(자동채우기)
  seed.js         예시 데이터
public/
  index.html      사이드바(필터) + 지도 + 상세 패널
  css/style.css
  js/
    app.js        오케스트레이션(상태·필터·상세)
    map.js        MapLibre + 사진카드 마커 + declutter 연동
    declutter.js  겹침 제거(최고점 생존) 알고리즘
    ui.js         상세 패널 / 투표 / 후기 / 등록 모달
    util.js       포맷·필터 유틸
    api.js        fetch 래퍼
```

## 참고

- `data/`(SQLite), `uploads/`, `node_modules/`, `.env` 는 git에서 제외됩니다.
- Node 18+ 필요 (개발/검증은 Node 20).
