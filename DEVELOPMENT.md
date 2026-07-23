# Cafe in Seoul — 개발/운영 노트

> 사용자용 소개는 [README.md](README.md), 인수인계는 [HANDOFF_260721.md](HANDOFF_260721.md) 참고.

카공(카페 공부)하기 좋은 서울 카페 + 사진 찍기 좋은 장소를 지도에서 찾는 웹앱. 지도 위에 **핀 대신
대표사진 카드**를 띄우고, 줌아웃해서 카드가 겹치면 **카페는 종합점수, 사진 스팟은 따봉 수가 높은 쪽만
남깁니다**. 한/영 전환 시 UI뿐 아니라 **이름·리뷰·댓글 등 콘텐츠까지 AI로 번역**됩니다.

두 카테고리:
- **주인장 추천 카페** — 카공 관점에서 큐레이션한 카페 (종합점수 기반).
- **주인장 추천 명소** — 뷰·경치 좋은 장소 (필름/DSLR 사진, 따봉·댓글).

> ⚠️ **"뷰 맛집"이라는 표현은 폐기됨.** 위 두 이름을 사용("명소"는 경치 좋은 곳).

## 핵심 기능

- **밝은 미니멀 지도** — CARTO light_all 래스터 타일(자체 호스팅 벤더). 모바일에서 **북쪽 고정(회전 잠금)**.
- **사진 카드 마커 + 겹침 제거(declutter)** — 픽셀 충돌 계산으로 겹치는 카드 중 1등만 남기고 `+N` 배지로 흡수 개수 표시. 카페가 항상 사진 스팟보다 우선. (`public/js/declutter.js`)
- **상세 패널** — 대표사진 **슬라이딩 캐러셀**(스와이프/화살표/점, 손가락 따라 이동 후 스냅), 모든 필드, 지도 링크, 투표, 카공 총평, 후기/댓글.
- **필터 한 줄 배치** — 영업중 · ♥좋아요 · 카테고리 토글 / 상세: 다층 · 늦게까지(22시+) · 뷰 · 우천시 · 면적(이상) · 콘센트(이상). 면적·콘센트는 "이상" 최소 기준 드롭다운.
- **따봉(좋아요)** — 카페·사진 스팟 모두 로그인 후 따봉 가능. **♥좋아요 필터**로 내가 좋아요한 곳만 보기(비로그인 시 로그인 안내).
- **집단지성 투표(1–5)** — 커피맛·조용함·화장실. 사용자당 카테고리별 1표.
- **후기(스토리) + 댓글 + 사진** — 로그인 필요. 스토리 수정/삭제, 사진 업로드(첨부 기여자 표시).
- **카공 총평(study_review)** — 감시받는 느낌·개방감 등 카공 친화도 평가(필수, AI 초안 지원).
- **우천시 카페(rain_ok)** — 지하철역과 지하로 직접 연결된 곳(관리자 지정).
- **제안 → 심사 대기열** — 로그인 사용자는 누구나 카페/사진 스팟 제안 가능. 관리자는 자동 승인, 그 외는 **pending**(본인·관리자에게만 보임) → 관리자 승인/거절. 제안 시 관리자에게 이메일 알림(SMTP).
- **중복 생성 원천 차단** — 느린 업로드 중 다중 클릭으로 생기던 중복을 프론트(버튼 잠금) + 백엔드(멱등성 가드)로 구조적으로 방지.
- **점수 가중치** — 카공 점수 = ① 객관 필드(0~50) + ② 집단지성 투표(0~50). 각 절반은 가중평균×50이라 50/50 강제. 가중치는 **개인 설정(localStorage) > 사이트 기본값(admin 지정) > 내장 기본값** 순. admin은 편집기에서 "모두에게 기본값으로"로 전역 기본값 지정 가능(`/api/admin/score-weights`, `server/settings.js`).
- **PWA** — 설치 프롬프트(모바일), 서비스워커(network-first). 지도 스크린샷 대응(`preserveDrawingBuffer`).
- **관리자 통계** — 방문자(고유 세션)·행동(무엇을 클릭)·국가별·인기 카페/스팟·방문자별·실시간 활동 피드. 봇 필터. **시간은 KST(UTC+9)**.
- **English 콘텐츠 번역** — EN 토글 시 이름·주소·카공총평·리뷰요약·리뷰본문·댓글을 OpenAI로 번역해 `*_en` 컬럼에 저장·표시(한글 폴백).

## 스택

Express 4 · better-sqlite3(WAL) · express-session/passport(scrypt) · multer · sharp(이미지 압축+썸네일) ·
nodemailer(SMTP) · OpenAI(gpt-4o-mini) · MapLibre GL JS(자체 호스팅) · 번들러 없는 바닐라 ES 모듈 프론트.

## 빠른 시작

### Docker (권장 — 운영과 동일)
```bash
docker compose up -d          # http://localhost:8001, 컨테이너 cafe-in-seoul, user 1003:1003
docker compose logs -f app
docker compose restart        # server/*.js 편집 후 (public/은 무캐시 라이브)
```
- 바인드 마운트: `data/`(SQLite+백업) · `uploads/`(사진) · `public/` · `server/`.
- **주의(WAL-over-bindmount):** 호스트/`docker compose exec`로 DB에 쓰면 실행 중 컨테이너가 `restart` 전까지 못 봄. out-of-process DB 쓰기 후엔 반드시 restart.
- **주의(env):** `env_file: .env` 값은 컨테이너 **생성 시점**에만 읽힘. `.env` 변경 반영은 `docker compose up -d --force-recreate`.

### 로컬(Node)
```bash
npm install
npm start                     # http://localhost:3000
```

## 환경변수(.env — gitignore됨)

```
GOOGLE_CLIENT_ID=...apps.googleusercontent.com   # GIS 토큰 방식 → client ID만 필요(secret 미사용)
KAKAO_API_KEY=...                                 # 카카오 링크 자동 채우기/장소 검색
OPENAI_API_KEY=sk-...   OPENAI_MODEL=gpt-4o-mini  # 리뷰 요약·카공총평 초안·영어 번역
ADMIN_EMAILS=you@gmail.com                        # Google 로그인 관리자 허용목록(로컬 계정은 is_admin 컬럼)
ALERT_EMAIL / SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD   # 제안 알림 메일
BASE_URL=https://cafe-in-seoul.com  SESSION_SECRET=<랜덤>
```

## 로그인

- **로컬 아이디/비밀번호**(scrypt) — **대소문자 구분**(case-sensitive). 관리자: `sejun`, `damhiya`, `YGH`(=`ygh`).
- **Google SSO(GIS 토큰 방식)** — client **ID만** 필요, **secret 불필요**, **리디렉션 URI 불필요**. Google Cloud Console에서 **"승인된 자바스크립트 원본"** 에 `https://cafe-in-seoul.com` 추가. 관리자는 `.env`의 `ADMIN_EMAILS`에 이메일 등록.
- **📍 동네 토크(GPS 채팅)** — 카페별 채팅. 읽기는 누구나, 쓰기는 GPS 1km 이내 인증 시(서버 재검증).

## 배포 (Cloudflare Tunnel)

호스트에서 `cloudflared` 터널이 `cafe-in-seoul.com` → `localhost:8001`(컨테이너) 로 라우팅. `app.set('trust proxy', 1)` 설정됨(세션 쿠키 `secure`, `CF-Connecting-IP` 신뢰).

- **주의(Cloudflare 캐시):** Browser Cache TTL(4h)이 origin `no-cache`를 덮어써 stale JS를 서빙함. 정적 JS/CSS/HTML은 origin에서 `no-store`로 응답(Cloudflare BYPASS). 배포 후 한 번은 하드 새로고침 필요.

## 데이터 안전 (중요)

- **DB 데이터 절대 삭제 금지가 원칙.** `server/db.js`에 하드 가드: WHERE 없는 DELETE/UPDATE, DROP/TRUNCATE 차단(예외: `ALLOW_DESTRUCTIVE=1`). 삭제는 **soft-delete**(`status='rejected'`, 행 보존·지도에서 숨김).
- **자동 백업**: DB는 부팅 시 + 5분마다 `data/backups/` (60개 유지). **업로드 사진**은 `data/backups/uploads-mirror/` 로 미러(부팅+10분, 불변 파일만 복사). `npm run backups` / `npm run restore [latest|<file>]`.
- **사진 파일은 코드가 삭제하지 않음** — 행이 지워져도 파일은 "고아"로 남아 복구 가능.
- **UI 원칙:** 컬러 이모지 금지. 단색 SVG 아이콘(`icons.js`, `currentColor`) 또는 CSS-컬러 유니코드 기호만 사용.

## API 요약

| Method | Path | 설명 |
|---|---|---|
| GET  | `/api/cafes` · `/api/cafes/:id` | 목록(점수순, likes/liked/`*_en`) · 상세(후기·투표·따봉) |
| POST | `/api/cafes` · `/api/cafes/:id/vote` · `/reviews` · `/like` · `/cover` | 등록/투표/후기/따봉/대표사진 |
| GET/POST | `/api/viewspots` … `/:id/like` `/comments` `/photos` `/approve` `/reject` | 사진 스팟 |
| GET  | `/api/auth/me` · POST `/register` `/login` `/google/verify` `/logout` | 계정 |
| GET  | `/api/admin/insights` · `/analytics` · `/pending` · `/search` · POST `/enrich` `/draft-review` `/score-weights` | 관리자 |
| GET  | `/api/stats` · POST `/api/track` | 방문 통계 · 행동 이벤트 비콘 |

## 구조

```
server/
  index.js          Express + 세션 + 방문/이벤트 미들웨어 + 정적 서빙
  db.js             SQLite 스키마·마이그레이션·삭제 하드가드·자동백업
  score.js          카공 종합점수         cafeModel.js  투표집계+점수 데코
  settings.js       admin 전역 기본 점수 가중치(app_settings)
  auth.js           Google GIS + 로컬(scrypt, 대소문자 구분) + 관리자 판별
  kakao.js          카카오 검색/상세 추출   ai.js  리뷰요약·카공총평초안·translateBatch(영어번역)
  i18nContent.js    콘텐츠 영어번역(_en) 헬퍼   mailer.js  제안 알림 SMTP
  cafePhotos.js     대표사진(cover) 설정   images.js  sharp 압축+썸네일
  analytics.js      이벤트 기록 + 관리자 통계 집계(봇필터, KST)
  backupUploads.js  업로드 파일 미러 백업
  routes/           cafes · viewspots · reviews · admin
public/
  index.html        헤더(카테고리 토글+필터) + 지도 + 상세 패널
  css/style.css     밝은 미니멀 + 모바일 반응형
  js/  app.js(오케스트레이션) map.js(마커/declutter) declutter.js
       ui.js(상세/캐러셀/모달) i18n.js(t·L 번역헬퍼) score.js icons.js util.js api.js
  manifest.json · sw.js (PWA)
```

## 참고
- `data/*.db` · `data/backups/` · `uploads/*` · `node_modules/` · `.env` 는 git 제외.
- Node 20 권장.
