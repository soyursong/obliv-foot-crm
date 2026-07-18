# 풋센터 CRM — 환경변수 매트릭스 (ENV MATRIX, 권위 선언)

> 목적: supervisor 배포 QA phase1.5 "빌드 env 매트릭스" 게이트(dev_ops_policy.md v2.2)의
> **REQUIRED vs OPTIONAL 판정 권위 소스**. 이 표가 `import.meta.env.VITE_*` 사용처의
> 운영 주입 의무를 정의한다.
>
> 게이트 규약(요지): `import.meta.env.*` 사용처 전수 grep → REQUIRED 변수는 운영 bundle에
> 주입 값 ≥1건 매치 필수. **OPTIONAL 변수는 미주입(빈 값 graceful fallback)을 정상으로 간주
> = env_missing 블로커 아님.** (2026-05-08 dopamine VITE_CTI_DISPATCH_URL 누락 사고 재발방지가
> 게이트 취지 — 그 사고는 REQUIRED 변수였다. OPTIONAL 변수는 취지 대상 외.)

## REQUIRED (운영 미주입 = 배포 블로커)

| 변수 | 용도 | 미주입 시 |
|------|------|-----------|
| `VITE_SUPABASE_URL` | Supabase 운영 DB URL | 앱 부팅 불가 — 전 기능 중단 |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon(공개) 키 | 인증·데이터 호출 전면 실패 |
| `FOOT_ORIGIN_SLUG` | 도파민 push·cross-CRM 귀속 origin slug | 리드 귀속 오류 |

→ 2026-06-30 `vercel env ls production` 확인: 위 3개 모두 등록됨(Production).

## OPTIONAL (운영 미주입 = 정상 graceful fallback, 블로커 아님)

| 변수 | 용도 | 미주입 시 동작(설계) | 코드 근거 |
|------|------|----------------------|-----------|
| `VITE_KAKAO_REST_API_KEY` | 외국인 셀프접수 국내체류지(숙소) 주소검색 — 카카오 로컬 API REST 키(무료티어, A안 MSG-20260625-145747-roay) | 빈 값 → `manualMode=true` 초기화 → 숙소검색 위젯이 **수기 주소입력**으로 자동 전환. 예약/고객/체크인 등 타 기능과 무관(Supabase만 사용). | `src/components/ForeignStayAddressInput.tsx` L86–88 (`apiKey ?? ''` → `useState(!apiKey)`), L127–133 (호출 실패 시에도 `setManualMode(true)` fallback) |

### OPTIONAL 변수의 구조적 grep 한계 (중요)
- Vite는 빌드타임에 `import.meta.env.VITE_KAKAO_REST_API_KEY`를 **값으로 인라인**한다.
  미주입(빈 값)이면 `''`로 인라인 → **변수명도 값도 bundle에 나타나지 않음**.
- 따라서 OPTIONAL 빈 변수는 bundle grep으로 "주입 여부"를 절대 검증할 수 없다(항상 0건).
  이는 키 미발급 상태의 **정상**이며 버그가 아니다.
- 카카오 검색을 운영 활성화하려면: 카카오 개발자콘솔에서 REST 키 발급(사람 액션) →
  `vercel env add VITE_KAKAO_REST_API_KEY production` → 재배포. (도메인 제한 설정 필수 — 프론트 노출 키)
  키 발급 전까지는 빈 값 유지 = 수기입력 모드로 정상 운영.

## 테스트/E2E 격리 DB (obliv-foot-dev) — T-20260719-foot-HARNESS-TESTDB-ISOLATION

> cross-CRM dev-DB 격리 표준의 foot 롤아웃(scalp 선례 복제, 부모 `T-20260616-meta-CRM-DEVDB-PROJECT-SPLIT` foot 슬라이스).
> **prod 번들·prod DB 무접점** — 아래는 오직 E2E/CI + dev 브랜치 preview 타겟에만 해당.

| 항목 | prod (운영) | dev (E2E/CI · preview 격리) |
|------|-------------|------------------------------|
| Supabase 프로젝트 | crm-obliv-foot | **obliv-foot-dev** |
| ref | `rxlomoozakkjesdqjtvd` | `kcdqtyivtqcjmcrdjkqi` |
| region | ap-southeast-1 | **ap-northeast-2 (Seoul)** |
| PHI | 실환자 | **0 (합성 시드만)** |
| 대상 origin | obliv-foot-crm.pages.dev | dev.obliv-foot-crm.pages.dev |

- env-pair 불변식(dev_ops_policy §1-α): 도메인당 non-prod ref 1개 — 본 dev 프로젝트가 **CF Pages Preview AND E2E/CI 타겟 겸용**(branch DB 불요).
- **컷오버(원자 단위, supervisor 협업)** — dev DB 스키마 적재 완료 후에만 일괄 전환:
  1. 스키마 baseline: `scripts/sync-schema-to-dev.sh` (prod schema-only pg_dump → dev + 합성 PHI-0 시드). prod DB 비번=supervisor 보유.
  2. CI secret: `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` → **dev 자체 값**(prod 키 재사용 금지, P1 SERVICEROLE-KEY-EXPOSURE 정합).
  2b. **PRODREF-HARDGUARD 활성**: CI secret·로컬에 `EXPECT_DEV_DB_REF=kcdqtyivtqcjmcrdjkqi` 주입.
      → `tests/fixtures/index.ts assertExpectedDbTarget()`(global-setup/teardown 검문)가 이후
      secret 오배선으로 target 이 prod ref 로 되돌아가면 pre-sweep·픽스처 write 이전에 즉시 abort.
      **컷오버 전에는 미설정 유지**(무동작 → 현행 prod 타겟 CI 무파손). defense-in-depth 2차 방벽.
  3. 로컬 `.env.local` E2E 타겟 → dev ref.
  4. AC-2 sim-flag: `tests/fixtures/index.ts` `simulation` 기본값 전면 on(dev DB엔 실환자 뷰 없음 → 가시성 spec 무파손, 매듭 자동 해소).
  5. CF Pages preview env → dev ref.
  6. §1-α 번들-스모크 grep 2개 GREEN(dev ref ≥1 / prod ref =0) + env-pair 매칭 → 그때만 deploy-ready.
- **하드가드 존치**: 부모 AC-3 REGISTRY teardown / PRODREF-HARDGUARD 제거 금지(defense-in-depth). dev 전환 후에도 leak 위생 가드 유지.
- 재게이트 트리거 2개뿐: ①prod 스키마 변경 발생 ②Supabase Pro 승급 비용 발생 → planner FOLLOWUP.

## 변경 이력
- 2026-07-19: **obliv-foot-dev(kcdqtyivtqcjmcrdjkqi, Seoul) provisioning 완료** — T-20260719-foot-HARNESS-TESTDB-ISOLATION.
  격리 dev Supabase 신설(PHI-0). 스키마 적재·컷오버는 supervisor 협업(위 §테스트/E2E 격리 DB). prod 무접점(db_change=false).
- 2026-06-30: 신설. T-20260630-foot-REVISIT-CHECKIN-AUTOASSIGN-SKIP QA phase1.5 env_missing
  false-positive(VITE_KAKAO_REST_API_KEY=OPTIONAL) 해소 근거. supervisor 게이트 OPTIONAL 예외 권위 소스.
- 2026-07-01: **동일 false-positive 재발 기록** — T-20260630-foot-CODY-WRITE-PERM-PARITY-SWEEP
  QA phase1.5가 `VITE_KAKAO_REST_API_KEY` bundle grep NOT_FOUND을 env_missing 블로커로 재판정
  (MSG-20260701-063954-1ox8). 본 문서 §22(OPTIONAL≠블로커)·§28(grep 구조적 0건=정상) 규약상
  **블로커 아님**. PROD 재실측으로 graceful fallback 정상 동작 확정:
    · `vercel env ls production` = FOOT_ORIGIN_SLUG / VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 3개만
      (REQUIRED 3개 전부 등록, OPTIONAL 카카오키 미발급 = 설계상 정상).
    · prod 번들 `assets/index-BDMQidPZ.js` + lazy chunk `assets/SelfCheckIn-Dnte6McY.js`
      양쪽 모두 `VITE_KAKAO_REST_API_KEY` 변수명 0건(Vite 인라인 → 변수명 소거, §29 그대로).
    · chunk 내 `apiKey` 인라인값 = `b=""`(빈 문자열) → `useState(!b)`=수기입력모드,
      `data-search-ready="false"` 런타임 확정. 카카오검색 비활성·수기입력 fallback 정상.
  → 카카오키는 본 티켓(coordinator write-RLS parity) surface와 **직교**. 키 발급은 사람 액션
    (§33~35)이며 별건. supervisor phase1.5 env-matrix 게이트는 본 변수를 OPTIONAL 예외로 통과시켜야 함.
