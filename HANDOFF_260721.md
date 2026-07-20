# HANDOFF — Cafe in Seoul (2026-07-21)

카공 카페 + 사진 스팟 지도 웹앱. 운영 중: **https://cafe-in-seoul.com** (Cloudflare Tunnel → 컨테이너 `cafe-in-seoul` :8001). 이 문서는 다음 작업자가 바로 이어갈 수 있게 정리한 것. 상세 기능은 `README.md` 참고.

## 1. 지금 상태 (한 줄)
안정 운영 중. UI/UX 정리, 따봉·좋아요 필터, 중복생성 차단, 사진 슬라이딩 캐러셀, **전체 콘텐츠 영어 번역**, 방문/행동 분석(관리자 통계), 사진·DB 자동 백업까지 완료.

## 2. 실행/배포
```bash
docker compose up -d            # :8001, user 1003:1003, restart:unless-stopped
docker compose restart          # server/*.js 편집 후 (public/은 무캐시 라이브 반영)
docker compose up -d --force-recreate   # .env 변경 반영 시 (env_file은 생성시점에만 읽힘)
```
호스트에서 `cloudflared`(root, systemd/백그라운드)가 도메인 라우팅. `.env`는 gitignore.

## 3. 반드시 지킬 규칙 (여기서 사고 많이 남)
1. **DB 데이터 삭제 금지.** 사용자 데이터는 전부 실데이터. 삭제는 soft-delete(`status='rejected'`). `db.js` 하드가드가 WHERE 없는 DELETE/DROP 차단. 정말 필요하면 **사용자에게 명시 확인 + `db.backupNow()` 먼저 + WHERE id로 정확히**. (과거 데이터 유실로 사용자 크게 분노)
2. **컬러 이모지 금지.** 단색 SVG 아이콘(`icons.js`, `currentColor`) 또는 CSS-컬러 유니코드 기호(♥ 등)만. 스타일 통일이 원칙.
3. **WAL-over-bindmount:** `docker compose exec`/호스트 node로 DB에 쓰면 실행 중 컨테이너는 `restart` 전까지 못 봄. out-of-process 쓰기 후 반드시 restart. 읽기도 exec의 readonly 연결은 컨테이너 라이브 WAL을 못 볼 수 있음 → 컨테이너 자체 연결(API)로 검증하거나 restart 후 읽기.
4. **로컬 로그인 대소문자 구분**(case-sensitive). 관리자 계정 직접 insert 시 provider_id 대소문자 주의(과거 YGH 대문자로 넣어 로그인 잠김).
5. **사진 파일은 코드가 안 지움** — 행 삭제 시 파일은 고아로 남아 복구 가능(uploads-mirror 백업도 있음).

## 4. 검증 방법 (프론트)
- 파스체크: 프론트 ESM은 `.mjs`로 복사 후 `node --check`. CSS 중괄호 밸런스 체크.
- 하네스: `scratchpad/harness.mjs` (jsdom, localhost:8001에서 fetch). **매 실행마다 public/js를 jsmod/로 자동 복사**하도록 패치돼 있음(예전엔 stale copy로 헛통과한 적 있음). maplibregl 스텁이라 `?.` 방어 필요.
- 서버 검증은 served 페이지(`curl localhost:8001/...`) + 컨테이너 자체 연결 쿼리로.

## 5. 최근 세션 주요 변경 (커밋)
- **따봉(likes)**: 카페·사진스팟 `*_likes` 테이블, 토글 엔드포인트, 상세 버튼 + 카드 배지. 사진스팟은 따봉 수로 declutter 생존.
- **♥좋아요 필터**: 로그인 게이트, 세션 미저장. 리스트에 `liked` 포함.
- **중복 생성 차단**: 프론트 제출버튼 잠금 + 백엔드 멱등성 가드(같은 사용자·이름·~55m). 기존 중복(잠수교 5개 등) 정리 완료.
- **사진 슬라이딩 캐러셀**: `ui.js setupHero` — flex 트랙 translateX, 손가락 따라 이동+스냅, 방향잠금.
- **영어 콘텐츠 번역**: `*_en` 컬럼(cafes/viewspots/reviews/viewspot_comments), `ai.translateBatch`(객체-래핑 언랩 처리), `i18nContent.js`(생성/수정 시 백그라운드 번역), 프론트 `i18n.L(obj,field)`. 기존 콘텐츠 일괄 번역 완료(카페51·스팟55·리뷰21).
- **분석(analytics)**: `events` 테이블 + `/api/track` 비콘 + 관리자 통계(방문자·행동·인기·세션·피드). 봇 필터. **로그 시간 KST(+9h)**.
- **자동 백업**: DB(5분) + uploads 미러(`backupUploads.js`, 10분).
- **UI 정리**: "뷰 맛집" 완전 제거 → "주인장 추천 카페"/"주인장이 찍은 사진"(짧게 "카페"/"사진"). 카테고리 토글 헤더 인라인, 필터 한 줄, 아이스아메리카노→"아아", 면적/콘센트 자체라벨 드롭다운(+ⓘ 기준 툴팁), 우천시 우산 아이콘, 모바일 로그인 중앙정렬, 지도 스크린샷(`preserveDrawingBuffer`).

## 6. 알려진 이슈 / 다음 할 일
- **Gmail SMTP 인증 실패**(`535 BadCredentials`) — 제안 알림 메일 안 감. `millipede306@gmail.com` 앱 비밀번호 재발급 후 `.env SMTP_PASSWORD` 갱신 필요. 지금은 관리자가 심사 대기열 수동 확인.
- **오프사이트 백업 없음** — 백업이 전부 같은 디스크. git 원격도 없음. 사진/DB를 git push 또는 외부 스토리지로 동기화하면 디스크 장애 대비 가능(미착수).
- **방문 day 버킷은 UTC** — 로그 ts는 KST로 고쳤지만 `daily_visits.day`/이벤트 `day`는 아직 UTC 날짜. 필요하면 KST 날짜로.
- **주소 EN 번역 품질** — AI 로마자화라 완벽하진 않음. 어색한 항목은 해당 행만 재번역.
- 사진스팟 필름/DSLR 규칙은 안내문일 뿐 강제 아님.

## 7. 계정/도메인
- 도메인 `cafe-in-seoul.com` (Cloudflare). Google OAuth 클라이언트: **웹앱** 타입, "승인된 자바스크립트 원본"에 도메인 등록 필요(리디렉션 URI 불필요).
- 관리자: `sejun`(owner), `damhiya`, `YGH`(=`ygh`). 사용자 문의: **skg4078@snu.ac.kr** (계정 팝업 하단 링크).
- 세션 기록: 자세한 진행/결정은 대화 메모리(`~/.claude/.../memory/`)의 `never-delete-db-data`, `no-color-emoji-use-icons`, `seoul-cafe-project` 참고.
