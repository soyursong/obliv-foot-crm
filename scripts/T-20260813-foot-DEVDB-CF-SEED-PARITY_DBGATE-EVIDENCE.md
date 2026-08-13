# T-20260813-foot-DEVDB-CF-SEED-PARITY — DB-GATE EVIDENCE (dev-foot authoring)

**근인 pin + 멱등 fix + 롤백 + introspect 근거.** 작성: dev-foot 2026-08-13.
- 대상 DB = **obliv-foot-dev** (ref `kcdqtyivtqcjmcrdjkqi`, PHI-0 E2E/CI 격리 DB) — **NOT prod**.
- prod(`rxlomoozakkjesdqjtvd`) 무접점. 본 leg `db_change`(prod)=false. dev-DB write = **supervisor DB-GATE** (§20-4 도메인격리: dev-foot 직접 write 불가).
- 부모: T-20260812-meta-CLOSING-HERALD-CF5-E2E-PROD-WRITE-BAN (격리 컷오버 0aa6d3c4). 본 leg = foot deploy lane HALT 해제의 유일 잔여 primary green-blocker.

---

## 1. 증상 (재현된 실측)

CF-1 `critical-flow/CF-1-new-patient-full-cycle.spec.ts` **test 2 '칸반 카드 발견(초진대기 진입)'** 만 timeout ×3 (run 31666620590 / 31615711643). Critical Flow 19 passed / 1 failed. 컷오버·가드 코드결함 아님.

- test 2 = seedCheckIn(exam_waiting) → `loginAndWaitForDashboard` → `[data-testid="checkin-card"][data-checkin-id=…]` 20s waitFor.
- 카드는 대시보드 `fetchCheckIns` 쿼리(`src/pages/Dashboard.tsx` L4331~)가 렌더한다.

## 2. 근인 = (b) 스키마 parity 갭 — `check_ins.deleted_at` 컬럼 부재 (NOT (a))

대시보드 `fetchCheckIns` 는 R2B soft-hide 제외를 위해 `.is('deleted_at', null)` 필터를 건다(L4336):

```
supabase.from('check_ins')
  .select(`${CHECKIN_LIST_COLS}, customers(name, chart_number)`)
  .eq('clinic_id', clinic.id)
  .is('deleted_at', null)   // ← dev DB에 이 컬럼이 없음
  .gte('checked_in_at', start).lte('checked_in_at', end)
```

obliv-foot-dev 의 `check_ins` 에는 `deleted_at`/`deleted_by` 컬럼이 **없다**. 이 컬럼은 prod 마이그레이션 **`20260725160000_foot_check_ins_soft_hide.sql`** (ADD COLUMN) 이 추가한 것으로, dev DB 프로비저닝(2026-07-19, `scripts/sync-schema-to-dev.sh`) **이후** 랜딩 → **dev 미동기 = 스키마 drift**.

→ `.is('deleted_at', null)` 가 `column check_ins.deleted_at does not exist` 로 에러 → `fetchCheckIns` 가 `toast.error` 후 조기 return → **카드 0건** → 20s timeout.

### introspect 근거 (READ-ONLY)

```
-- (1) dev check_ins 에 deleted_at 부재 확정
select column_name from information_schema.columns
 where table_schema='public' and table_name='check_ins'
   and column_name in ('deleted_at','deleted_by');
→ (0 rows)   -- prod 에는 2종 존재
```

### authenticated 재현 (anon 키 + DEV_TEST 계정 로그인 → seed → 조회)

| 조건 | err | rows | seed 포함 |
|---|---|---|---|
| `.is('deleted_at', null)` **O** (현행 대시보드) | `column check_ins.deleted_at does not exist` | 0 | ✗ → **카드 미렌더 → timeout** |
| `.is('deleted_at', null)` **제거** (fix 후 등가) | none | 1 | ✓ → **카드 렌더 → CF-1 green** |

→ **`deleted_at` 부재가 유일 블로커.** 아래 축은 전부 정합(가설 (a) 반증):

- **clinic 정합**: dev `clinics` = `4478bdb0-…`(slug `jongno-foot`) 단일 존재. `FIXTURE_CLINIC_ID`(=`DEV_ISOLATION_CLINIC_ID`) = `4478bdb0-…` 일치. 앱 `getClinic()` = `slug='jongno-foot'` 해석 → 동일 clinic.
- **계정 멤버십 정합**: DEV_TEST(`e2e-isolation@obliv-foot-dev.local`, uid `9e92081e-…`) `user_profiles` row 존재 = clinic `4478bdb0-…`, role admin, approved=t, active=t (**created 2026-08-10**, 실패 run 08-13 이전부터 정합). RLS `check_ins_read`(`is_approved_user() AND clinic_id=current_user_clinic_id()`) 통과 — `current_user_clinic_id()`/`is_approved_user()` 는 `user_profiles` 기준(staff 아님).
- **checked_in_at 윈도우 정합**: seedCheckIn = `checked_in_at=now(UTC)`, CI `TZ=Asia/Seoul` → KST 당일 윈도우 내.
- **is_simulation 노출 정합**: seed 고객 phone `DUMMY-%` → `stripSimulationRows` 노출 예외(isExposedFixture) → 숨김 안 됨.

## 3. 처분 = 멱등 ADDITIVE 마이그 apply (기존 파일 재사용)

**신규 authoring 불요** — 정본 마이그가 이미 repo 에 있고 완전 멱등·ADDITIVE·단일 트랜잭션·검증블록 내장:

- apply : `supabase/migrations/20260725160000_foot_check_ins_soft_hide.sql`
  - `ALTER TABLE public.check_ins ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS deleted_by uuid;`
  - `CREATE INDEX IF NOT EXISTS idx_check_ins_live_clinic_checkedin … WHERE deleted_at IS NULL;`
  - `CREATE OR REPLACE FUNCTION foot_stats_consultant / foot_stats_noshow_returning` (deleted_at-aware)
  - 말미 DO-block 검증(컬럼 2종 미생성 시 RAISE→롤백).
- rollback : `supabase/migrations/20260725160000_foot_check_ins_soft_hide.rollback.sql`

### apply 안전성 (dev 실측 선검증)

- **의존 객체 전부 dev 존재**: `status_transitions`, `packages`, `package_payments`, `payments`, `reservations`, `staff` (전 6종 ✓).
- **두 함수 이미 dev 존재**(구버전) → `CREATE OR REPLACE` 안전(신규 create 아님).
- ADD COLUMN IF NOT EXISTS → 기존 populated dev 위에 비파괴 적용, backfill 0, seed roster/user_profiles 무접촉.

### DB-GATE 요청 (supervisor)

```
psql "$DEV_SUPABASE_POOLER_SESSION" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260725160000_foot_check_ins_soft_hide.sql
-- 접속정보 = .env.dev-isolation.local (DEV_SUPABASE_POOLER_SESSION). prod 무접점.
```

### apply 후 검증 (POST-VERIFY)

```
select count(*) from information_schema.columns
 where table_schema='public' and table_name='check_ins'
   and column_name in ('deleted_at','deleted_by');   -- 기대 = 2
```
→ 2 확인 후 CF5 브랜치(`fix/T-20260812-meta-CF5-CI-DEVDB-CUTOVER`) CI 재실행 → CF-1 green(Critical Flow 20/20) 기대.

## 4. 잔여 latent drift (본 티켓 non-blocking · 후속 권고)

dev DB 는 2026-07-19 프로비저닝 후 미재동기 → soft_hide 외 다수 post-0719 ADDITIVE 마이그가 dev 미반영(예: `20260803090000_…assignment_consult_type`, `20260811010000_…kcd_code_b3`). 단 이들 컬럼은 **대시보드/CF live-read 경로 미참조** → 현재 CI 무영향(latent). CF-1 재green 에는 §3 만으로 충분.

- **후속 권고(planner)**: 향후 whack-a-mole 방지 위해 `scripts/sync-schema-to-dev.sh`(supervisor PROD creds) 재실행으로 dev 전체 스키마 parity 재정렬 — 단 destructive 재복원은 [E2E-SEED] staff roster + DEV_TEST `user_profiles` 재프로비저닝 필요(별 트랙). 본 EXPEDITE 블로커와 분리.
