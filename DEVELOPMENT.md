# Cafe in Seoul — 개발/운영 노트

> 사용자용 소개는 [README.md](README.md), 인수인계는 [HANDOFF_260721.md](HANDOFF_260721.md) 참고.

카공(카페 공부)하기 좋은 서울 카페 + 사진 찍기 좋은 장소를 지도에서 찾는 웹앱. 지도 위에 **핀 대신
대표사진 카드**를 띄우고, 줌아웃해서 카드가 겹치면 **카페는 종합점수, 사진 스팟은 따봉 수가 높은 쪽만
남깁니다**. 한/영 전환 시 UI뿐 아니라 **이름·리뷰·댓글 등 콘텐츠까지 AI로 번역**됩니다.

두 카테고리:
- **주인장 추천 카페** — 카공 관점에서 큐레이션한 카페 (종합점수 기반).
- **주인장 추천 명소** — 뷰·경치 좋은 장소 (필름/DSLR 사진, 따봉·댓글).

> **"뷰 맛집"이라는 표현은 폐기됨.** 위 두 이름을 사용("명소"는 경치 좋은 곳).

## 핵심 기능

- **밝은 미니멀 지도** — OpenFreeMap **Positron** 벡터 스타일(`tiles.openfreemap.org/styles/positron`, 무료·키 불필요). 원래 CARTO light_all 래스터를 썼으나 **2026-08 CARTO가 무료 basemap에 API 키를 강제(타일마다 "API KEY REQUIRED" 워터마크)** 해서 교체 — 같은 Positron 회색조 룩 유지. MapLibre 벤더는 자체 호스팅, basemap 스타일만 OpenFreeMap hosted. 모바일에서 **북쪽 고정(회전 잠금)**.
- **사진 카드 마커 + 겹침 제거(declutter)** — 픽셀 충돌 계산으로 겹치는 카드 중 1등만 남기고 `+N` 배지로 흡수 개수 표시. 카페가 항상 사진 스팟보다 우선. (`public/js/declutter.js`)
- **상세 패널** — 대표사진 **슬라이딩 캐러셀**(스와이프/화살표/점, 손가락 따라 이동 후 스냅), 모든 필드, 지도 링크, 투표, 카공 총평, 후기/댓글.
- **명소는 사진 우선** — 사진 전시가 목적이라, 명소 카드 클릭 시 곧바로 **중앙 대형 뷰어**(원본 비율, `openLightbox`의 `opts.spot` 모드)가 뜬다. 여러 장은 **3-슬라이드 트랙**(이전/현재/다음 `<img>`)이라 좌우 화살표/키보드/**터치 스와이프** 시 손가락 따라 밀리고 스냅되는 **슬라이드 전환**(툭 바뀌지 않음). 하단 캡션 바에 이름·촬영자·♥좋아요·"댓글·상세" 버튼. 상세 패널(댓글·사진추가)은 그 버튼으로 한 단계 더. `?view=<id>` 딥링크도 이 뷰어를 연다. 카페는 정보 우선이라 기존 상세 패널 유지.
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
- **유입 경로 · AI 노출** — 관리자 통계 "유입·AI" 탭. **사람 유입 경로**(Google/Naver/ChatGPT/Perplexity/Instagram/Direct…)는 pageview 때 `Referer` + `?utm_source`(OpenAI가 붙이는 `utm_source=chatgpt.com` 등)를 잡아 `events.referer/source`에 저장(자기 도메인 referer는 Direct 처리, 세션 소스 = 첫 non-Direct). **AI/검색 크롤러**(누가 우리를 색인하나)는 봇 UA를 `classifyCrawler`로 분류(ChatGPT/Perplexity/Claude/Gemini/Google/Bing/Social/SEO툴) — 과거 로그도 UA로 소급 집계. `kpi.aiCrawls`(AI 크롤러 페치 수), `kpi.aiReferrals`(AI 답변 링크로 들어온 사람). 주의: 크롤 ≠ 방문. Cloudflare가 GPTBot·ClaudeBot을 엣지에서 막아 origin엔 안 올 수 있음(OAI-SearchBot·ChatGPT-User는 통과).
- **관리자 통계** — 탭(요약/방문자/유입·AI/콘텐츠/**성능**/원본 로그) + 날짜 이동. 요약에 방문자·페이지뷰·행동·열람 전환율·재방문·모바일 비율, 14일 추이(막대 클릭 = 그 날로 이동), 시간대별 활동, "방문자가 어디까지 갔나"(이탈/둘러봄/열람/참여), 7일 인기 카페·명소·검색어. 봇 필터.
  **날짜는 전부 KST 기준** — 이벤트의 `ts`는 UTC로 저장하지만 집계는 `date(ts,'+9 hours')`로 KST 하루(00:00~24:00)를 만든다. 예전에는 `events.day`(UTC 날짜)로 묶어서 하루가 09:00~09:00 KST였고, 그래서 한 날의 피드에 두 날짜가 섞여 보였다.
  **"방문자"의 정의는 `analytics.visitorsOn(day)` 하나뿐** — 그 KST 날짜에 페이지를 연 고유 세션(봇·관리자 제외). 지도 화면 카운터(`/api/stats`)·관리자 요약·14일 추이·참여 단계가 전부 이 함수를 쓰므로 숫자가 어긋날 수 없다. `daily_visits`는 **누적 합계 전용**(이벤트 로깅 이전 기록 포함)이고 일자별 행은 레거시(UTC 경계로 집계돼 재계산 불가)이므로 읽지 않는다. 페이지 로드 없이 행동만 한 세션(어제 열어둔 탭 등)은 방문자가 아니라 `kpi.active`로 따로 표시.
  **내부/테스트 트래픽 제외** — 실 트래픽은 Cloudflare를 거쳐 항상 공인 IP(`cf-connecting-ip`)를 갖는다. 사설/루프백 IP(`127.*`, `10.*`, `192.168.*`, `172.16–31.*`, `::1`, `::ffff:` 매핑 포함)는 localhost 테스트(jsdom harness)이므로 `HUMAN` 집계 predicate에서 뺀다 — 과거 행에도 소급 적용(is_bot 백필 없이). harness의 비콘 UA(`node`)도 `BOT_UA`에 추가. **방문자 탭은 최근 활동순(last_seen desc), 원본 로그는 id desc** — 둘 다 최신이 위.
  **관리자 제외 정확도** — 이벤트 기록 시 `is_admin`을 예전엔 `req.user.is_admin`(DB 원시 컬럼)으로만 판정해서, **`ADMIN_EMAILS` 허용목록만으로 admin인 Google 로그인 계정(컬럼=0)의 방문이 "사람" KPI에 샜다**. 이제 `recordEvent`(와 `index.js`의 방문 카운터)가 `auth.isAdmin(req.user)`(컬럼=1 **또는** 이메일 허용목록)을 쓴다. 과거 행은 `events.user_id`(+관리자 세션)로 1회 백필 완료. 원본 로그 탭의 "봇·관리자 트래픽도 보기" 체크박스도 `is_admin`을 함께 필터한다(예전엔 `is_bot`만 봐서 관리자 행이 안 빠졌다).
- **English 콘텐츠 번역** — EN 토글 시 이름·주소·카공총평·리뷰요약·리뷰본문·댓글을 OpenAI로 번역해 `*_en` 컬럼에 저장·표시(한글 폴백). 번역은 best-effort라 **OpenAI 크레딧이 없으면 조용히 스킵**되고 `_en`이 빈 채로 남는다 → `i18nContent.retranslateMissing()`가 부팅 30초 후 + 6시간마다 빈 `_en`(과 미지오코딩 region)을 찾아 채워 **크레딧 복구 시 자동 치유**(없으면 인덱스 스캔만, AI 호출 0).
- **번역 수동 수정(관리자)** — AI가 이름을 오역하기도 한다(콩카페=Cong인데 "Kong"). 계정 메뉴 → **번역 관리** 모달에서 카페/명소의 이름·주소·지역 영문을 직접 고칠 수 있다(`/api/admin/i18n` GET/PATCH/DELETE). 저장하면 그 필드가 **`i18n_locks`에 고정**되어 `translateRow`가 이후 재번역/self-heal에서 건너뛴다(덮어쓰기 방지). "AI 자동"은 고정을 풀고 다시 번역. `translateRow`가 락된 필드를 `todo`에서 제외하는 게 핵심.
- **지연(latency) 분석 도구** — 사진이 많아 렉을 진단해야 할 때. ① **서버 응답시간**: `server/perf.js`의 `timing` 미들웨어가 경로별 응답시간·바이트를 인메모리 링버퍼에 기록(p50/p95/p99, DB 기록 0 → 부하 없음, 재시작 시 초기화). ② **실사용자 RUM**: `public/js/perf.js`가 마커 렌더 직후 TTFB·LCP·지도표시시간·마커수를 `/api/perf`로 비콘. ③ **사진 라이브러리 감사**: `perf.assetAudit()`가 원본/썸네일 크기·누락·깨진(과대) 썸네일을 스캔. 셋 다 관리자 통계 **성능** 탭(`/api/admin/perf`)에 표시. 심층 CLI: `docker compose exec app node scripts/perf-report.js`(sharp로 실해상도까지), 썸네일 복구: `scripts/fix-thumbnails.js --apply`(누락·깨진 썸네일만 재생성, 손상 JPEG은 `failOn:'none'`으로 관대 디코드). **이미지 파이프라인**: 업로드 시 원본 ≤1600px q82 + `_thumb.jpg` 480px q72(`server/images.js`). 지도 카드·마커·그리드는 썸네일, 상세 hero 캐러셀·라이트박스만 원본. 캐러셀은 현재+좌우 슬라이드만 로드(lazy). `/uploads`·`/api/img` 7일 캐시.

## SEO (검색엔진/AI 노출)

지도는 클라이언트 렌더라 크롤러는 `/`에서 빈 껍데기만 본다. 그래서 **모든 장소를 서버 렌더 HTML 페이지로도 노출**한다(지도 UI는 그대로). `server/seo.js` 한 파일 + `index.js`에 라우터 마운트.

- **개별 페이지** — `/cafes/<이름>-<id8>`, `/views/<이름>-<id8>`. 각 페이지에 `<title>`·meta description·`<h1>`·자연어 본문(필드+카공총평)·`<img alt>`·specs·후기·`CafeOrCoffeeShop`/`TouristAttraction` JSON-LD·breadcrumb·canonical·hreflang·가까운 장소 내부링크. **별점(aggregateRating)은 넣지 않음**(카공점수는 고객 별점이 아니라 자체 지표).
- **영어 트윈** — `/en/cafes/...`, `/en/views/...` (기존 `*_en` 컬럼 사용). ko↔en `hreflang` 상호 연결.
- **디렉터리** — `/cafes` `/views` (+ `/en/...`)에 전체 목록. 각 상세/디렉터리가 서로 링크 → 크롤 그래프.
- **`/sitemap.xml`** — DB에서 동적 생성(홈+디렉터리+전 장소, `<image:image>`·ko/en `hreflang` 포함). **`/robots.txt`** — 전체 허용 + `OAI-SearchBot`(ChatGPT 검색) 명시 + sitemap.
- **지역명은 등록 시 저장** — 카페는 `address`(예: "부산 해운대구…")를 그대로 쓰고, **명소는 등록 시 좌표를 Kakao 역지오코딩(`kakao.reverseRegion`)해 `viewspots.region`("인천 제물포구")에 저장**한다. 영문은 기존 번역 파이프라인(`translateViewspot`이 `name`+`region` 번역 → `region_en`). 좌표 박스 추측은 폐기. `region`이 없으면 SEO 카피는 지역명을 생략(틀리게 "서울" 안 씀). 명소 문장 은/는은 `eunNeun`으로 받침 판정. **AI가 신설 행정구(예 인천 제물포구, 2026 신설)를 오번역**하므로 `i18nContent.REGION_EN`에 결정적 override를 둔다. 기존 데이터는 1회 백필 완료.
- **슬러그** = `slugify(name_en||name)` + `-` + `id`앞 8자. 이름 부분이 달라도 8자 id로 행을 찾고 **정식 슬러그로 301**. 미존재 → 404(정적으로 폴백).
- **www→apex 301** (`index.js` 최상단 미들웨어, 세션 이전). https는 Cloudflare가 처리.
- **딥링크** — `/?cafe=<id>` / `/?view=<id>`로 지도에서 해당 상세 자동 오픈(`app.js openFromUrl`); 카드 클릭 시 `history.replaceState`로 URL 공유 가능. SEO 페이지의 "지도에서 열기"가 여기로 연결.
- 홈 `index.html`엔 canonical·hreflang·WebSite JSON-LD + `<noscript>` 디렉터리 링크.

**수동(코드 밖):** Google Search Console 도메인 등록(DNS TXT) + `/sitemap.xml` 제출, Cloudflare Bot Fight Mode가 `OAI-SearchBot`을 막지 않는지 확인. **GPTBot(모델 학습)** 은 현재 허용(와일드카드) — 학습 사용을 막으려면 robots에 `User-agent: GPTBot\nDisallow: /` 추가.

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
- **동네 토크(GPS 채팅)** — 카페별 채팅. 읽기는 누구나, 쓰기는 GPS 1km 이내 인증 시(서버 재검증).

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
