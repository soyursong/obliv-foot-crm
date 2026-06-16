---
id: T-20260616-foot-E2E-PROD-WRITE-ISOLATION
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260616-foot-E2E-PROD-WRITE-ISOLATION.spec.ts
e2e_spec_exempt_reason: null
created: 2026-06-16
assignee: dev-foot
reporter: planner (MSG-20260616-211825-4zg1) — 부모 P0 PKG-CUSTNAME-ENCRYPTED RC#0 파생
source-msg: MSG-20260616-211825-4zg1
da-consult: 불요 (테스트 인프라/스펙 수정만 — 별도 DB 미도입, customers 등 운영스키마 변경 0)
fix-request: MSG-20260616-233701-xqcq (phase1 build_fail → scripts/build.sh --bg detached mode, commit 471f2191)
---

## FIX (MSG-20260616-233701-xqcq · 2026-06-17, commit 471f2191)
supervisor QA phase1 build_fail = foreground 50s safety ceiling 이 `build.sh 120` 을 외부 SIGKILL(exit 124). RC=physics(병렬-worktree CPU 경합 시 ~14s 빌드가 50s 초과), 티켓 코드/빌드 정상.
→ `scripts/build.sh --bg [deadline]` detached 모드 신설(`_build_runner.py` os.setsid 새 세션 → foreground kill 생존, sub-ceiling deadline polling → 항상 RESULT: OK|FAIL|RUNNING 반환). RUNNING=빌드 detached 계속 → `--status` 로 verdict 회수.
권장 QA: `bash scripts/build.sh --bg 45` → RUNNING 시 `bash scripts/build.sh --status`. 레거시 동기 모드 불변.

# T-20260616-foot-E2E-PROD-WRITE-ISOLATION — E2E PROD write 격리 (RC#0 재발방지)

## 배경 (RC#0)

E2E 가 dev=prod 단일 Supabase(rxlomoozakkjesdqjtvd)에 `service_role` 로 직접 write 한다.
개별 spec 은 try/finally·afterAll 로 cleanup 하지만 테스트가 **timeout/crash/abort** 로
죽으면 그 hook 이 실행되지 않아 `[QA-FIXTURE]` row(특히 customers)가 PROD 에 누적됐다.
특히 `seedCheckIn` 이 customer INSERT 후 check_in INSERT 전 중단되면 check_ins 경유
cleanup 으로는 안 잡히는 **orphan customer** 가 쌓였다. (착수 시점 PROD 잔존 `memo=MARKER`
customers **1325건** 실측)

## 채택안 — AC (c) 강화 (성공/실패 무관 cleanup 보장)

> dev=prod 단일연결이라 AC(b) "prod면 fixture-write spec 하드 스킵"은 전체 E2E 스위트를
> 죽이므로 비현실적. AC(a) 별도 DB 는 DA CONSULT 게이트 — 본 티켓 범위 밖(아래 포인터).
> → 별도 DB 미도입 + 운영스키마 변경 0 → 표준 supervisor QA 경로.

### 구현
1. `tests/fixtures/index.ts` — `cleanupAll()` 전면 강화:
   - **orphan customer 스윕**: customers 를 `memo=MARKER` + 이름접두(`qa-fixture-`/`qa-res-`)
     2차 키로 직접 스윕 → check_in 없는 고아 고객까지 제거 (RC#0 직격).
   - **페이지네이션**(`selectAllValues`, PAGE=1000): select 1000건 상한 truncate 로
     신규 픽스처가 페이지 밖으로 밀려 누락되던 2차 RC 차단.
   - **청크+per-id 폴백**(`deleteByIds`, CHUNK=50): `.in()` URL 길이 초과/한 행 FK 위반이
     배치 전체를 원자적으로 롤백 → 신규 픽스처까지 잔존하던 3차 RC 차단. legacy FK 막힌
     행만 `skippedCustomers` 로 격리(별도 PROD 정리 트랙 소관), 삭제 가능한 행은 전수 제거.
   - **안전 불변식**: 삭제 대상은 오직 QA 마커/이름접두 row 로만 도출 — 실데이터 불가침.
2. `tests/global-teardown.ts` (신규) — run 종료 시 성공/실패 무관 1회 `cleanupAll()` → 잔존 0 보장.
3. `tests/global-setup.ts` (신규) — run 시작 전 직전 잔존 pre-sweep(hard-kill 보강) + write 대상 URL 로깅.
4. `playwright.config.ts` — `globalSetup`/`globalTeardown` 배선 + 회귀 spec 을 `unit` 프로젝트 등록.

## AC 검증 (tests/e2e/T-20260616-foot-E2E-PROD-WRITE-ISOLATION.spec.ts)
- AC-1: orphan customer(memo=MARKER, check_in 없음) → cleanupAll 삭제 → 잔존 0 ✅
- AC-2: 정상 시드(customer+check_in+package) — **개별 cleanup 미호출(=실패 모사)이어도** cleanupAll 전수 삭제 ✅
- AC-3: 마커 누락 + 이름접두(qa-fixture-*) → 이름접두 2차 키로 삭제 ✅
- AC-4: 안전 불변식 — 비-픽스처(마커X·접두X) 실데이터는 cleanupAll 후 **보존** ✅
- AC-5: 인프라 배선 — globalSetup/Teardown 파일 + config 배선 + cleanupAll import ✅
- 회귀: unit 프로젝트 727 passed (사전 실패 13건은 무관 정적 소스 assert — baseline 동일 실패 stash 검증 완료, **regression 0**)

## 실측 효과
- 본 작업 실행으로 PROD `memo=MARKER` customers **1325 → 0** (삭제 가능분 전수 정리, globalTeardown 로그 `customers=0` 확인).

## 별도 트랙 포인터 (본 티켓 범위 밖)
- (권고) dev=prod 단일연결은 전 CRM 잠재리스크 → **data-architect "CRM dev/prod 분리" CONSULT** 제기 필요.
- 부모 P0 PKG-CUSTNAME-ENCRYPTED 의 PROD 일괄 정리(A안)는 대표 GO + supervisor db-gate 트랙에서 별도 진행.
