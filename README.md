# ☕ 서울 카공 지도 (seoul-cafe)

카공(카페 공부)하기 좋은 서울 카페를 지도에서 찾는 웹앱. 지도 위에 **핀 대신 카페 대표사진 카드**를 띄우고,
줌아웃해서 카드가 겹치면 **종합점수가 가장 높은 카페만 남깁니다**.

## 기능 (요구사항 매핑)

- **다크 미니멀 지도** — CARTO dark_matter 래스터 타일. `design.md` 톤(순흑 캔버스·화이트 타이포·고스트 필·무채색)으로 디자인.
- **사진 카드 마커 + 겹침 제거** — 줌 레벨마다 픽셀 충돌을 계산해, 겹치는 카드 중 종합점수 1등만 남기고 나머지는 숨김. 살아남은 카드에는 `+N` 배지로 흡수한 개수를 표시. (`public/js/declutter.js`)
- **카드 클릭 → 우측 상세 패널** — 사진, 모든 필드, 지도 링크, 투표, 후기.
- **필터** — 다층 여부 · 영업중/늦게까지 · 면적(소/중/대) · 콘센트 수준 · 아메리카노 가격 상한 · 집단지성 평가(조용함/커피맛/화장실) 최소점수.
- **카페 등록 (로그인 필요)** — 3단계 폼:
  1. **직접 입력**: 카페 이름, 카카오 지도 링크(필수·실제 장소 링크), 네이버 링크(선택)
  2. **가져온 정보(수정 가능)**: 카카오 링크로 위치·대표사진·영업시간·아이스아메리카노 가격·리뷰 AI요약을 불러오고 사람이 수정
  3. **직접 판단(카공 핵심)**: 층수(다층)·면적·콘센트·뷰 — 사람이 입력
  → 링크는 사람이 붙여넣은 **실제 장소 링크**만 저장(검색결과 링크 자동생성 없음).
- **집단지성 투표(1–5)** — 커피맛 · 조용함 · 화장실 청결. 사용자당 카테고리별 1표(재투표 시 갱신).
- **후기 + 사진 (로그인 필요)** — 자유 텍스트 + 이미지 업로드.
- **종합점수** — discrete 필드(최대 50) + 투표(최대 50, 조용함 가중치 최고)로 0–100 산출. 카드 겹침 우선순위 = 이 점수. (`server/score.js`)
- **SSO 로그인** — Google Identity Services(GIS). **client ID만 필요(secret 불필요).** 미설정 시 **데모 로그인(닉네임 입력)** 으로 모든 기능 사용 가능.
- **🤖 카카오 링크 → 자동 채우기 (관리자)** — 붙여넣은 카카오 장소 링크에서 좌표·주소·영업시간·아메리카노가격·사진을 규칙기반으로 추출하고, 리뷰를 OpenAI가 **한 문단 요약**. 층수/면적/콘센트/뷰 같은 주관적 판단은 자동추론하지 않고 사람이 입력.
- **계정 로그인** — 아이디/비밀번호 회원가입·로그인(scrypt) + Google SSO 병행. 시드 관리자 `sejun`/`chongchong`.
- **AI 심사(pending/approved)** — 누구나 카페 등록 가능. 관리자는 자동 승인, 그 외는 AI가 실존(카카오)·특별함(심야/대형복층/뷰)을 판단해 승인 또는 **pending**(본인·관리자에게만 표시, 관리자 승인 전 비공개).
- **실시간 영업중 필터 기본 ON** — 시간이 가장 중요한 필터. 기본은 지금 영업중인 카페만, 토글로 해제.
- **📍 동네 토크(GPS 채팅)** — 카페별 채팅. 읽기는 누구나, **쓰기는 GPS 1km 이내 인증** 시에만(서버가 거리 재검증). 실제 그 장소 사람들의 이야기를 담는 소셜.
- **관리자 수정** — 상세에서 ✎ 수정으로 층수/면적/콘센트/뷰 등 큐레이션.

## 빠른 시작

```bash
npm install
npm run seed      # 실제 서울 카페 11곳(카카오 데이터) + 데모 유저/투표/후기
npm start         # http://localhost:3000
```

- 로그인: 사이드바에서 **아이디/비밀번호** 로그인 또는 회원가입. (Google 버튼도 표시)
  - 시드 관리자 계정: **`sejun` / `chongchong`** (자동채우기 등 관리자 기능 사용 가능).
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
`GOOGLE_CLIENT_ID`가 있으면 Google 버튼이 뜹니다. (아이디/비밀번호 로그인은 항상 가능)

### `Error 401: invalid_client` / `no registered origin` 고치기
GIS는 **리디렉션 URI가 아니라 "승인된 자바스크립트 원본"** 을 봅니다. 콘솔의 해당 OAuth 클라이언트에서:
- 클라이언트 타입이 **웹 애플리케이션**인지 확인.
- **승인된 자바스크립트 원본**에 접속 주소를 정확히 추가: `http://localhost:3000`
  (127.0.0.1로 접속하면 `http://127.0.0.1:3000`도 별도 추가 — localhost와 다름).
- 저장 후 반영에 몇 분 걸릴 수 있음. 그동안은 **아이디/비밀번호 로그인**으로 사용.
- 관리자 Google 계정은 `.env`의 `ADMIN_EMAILS`에 이메일을 넣어야 관리자 권한을 받습니다.

## 🤖 카카오 링크 → 자동 채우기 (관리자 전용)

사람이 **실제 링크**를 넣고 나머지를 자동으로 채우는 방식(검색결과 링크를 지어내지 않음).

1. 카페 이름 + 카카오 지도 **장소 링크** 붙여넣기 (모르면 "🔎 검색으로 링크 찾기"로 실제 place_url 획득).
2. **가져오기** 클릭 →
   - **규칙 기반**(카카오 `panel3`): 좌표·주소·영업시간·아이스아메리카노 가격(메뉴)·대표사진 후보.
   - **AI**(OpenAI): 카카오 리뷰/블로그를 **한 문단 요약** + 키워드. (층수·면적·콘센트·뷰는 자동추론 안 함 → 사람이 판단)
3. 관리자가 확인·수정 후 저장.

지원 링크: `place.map.kakao.com/<id>`, `map.kakao.com/?itemId=<id>`, 공유 단축링크(리다이렉트 추적). 좌표만 있는 `link/map` 링크는 장소ID가 없어 미지원.

필요 env: `KAKAO_API_KEY`(카카오 REST 키), `OPENAI_API_KEY`(+선택 `OPENAI_MODEL`, 기본 `gpt-4o-mini`).
> 카카오 상세(영업시간/메뉴/리뷰)는 비공식 내부 엔드포인트(`panel3`)를 사용 — 스펙이 바뀌면 조정 필요. AI 요약이 실패해도(예: OpenAI 5xx, 자동 재시도함) 카카오 기본 정보는 채워집니다.

## (검토) 정부 인허가 데이터로 카페 일괄 수집

전국 카페는 **LOCALDATA(지방행정 인허가 데이터)**의 `휴게음식점` 업종에서 상호·주소·좌표·영업상태를 대량으로 받을 수 있습니다. 단:
- 좌표계가 **EPSG:5174(중부원점 TM)** — WGS84(lat/lng)로 변환 필요(`proj4`).
- Open API는 **변동분**만, 전체는 다운로드(CSV). **인증키 필요**(무료).
- 영업시간/사진/리뷰는 없음 → **카카오로 보강 + AI 요약**하는 파이프라인으로 연결.
- ⚠️ 2026-04-16부로 `localdata.go.kr`가 **공공데이터포털(data.go.kr)** 로 이관됨.

즉 "정부 데이터로 뼈대(상호·위치) 일괄 → 카카오로 살(사진·영업시간·리뷰) → AI 요약"이 현실적 로드맵.

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
| GET  | `/api/admin/search?q=` | 카카오 카페 검색 → 실제 place_url (admin) |
| POST | `/api/admin/enrich` | `{kakaoUrl}` → 좌표/사진/영업시간/가격 + 리뷰 AI요약 (admin) |

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
