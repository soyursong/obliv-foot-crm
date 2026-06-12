# T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN — DB-gate 제출 (dev-foot) — REVISE(policy_correction_jnz7)

> ★★ 정책 정정 (김주연 총괄 직접, MSG-...185107-jnz7 / §13.1.A reporter-authorized) ★★
> 이전 제출(LOCK)은 **'일마감'을 '매출집계'로 오분류**. 본 문서가 그 revise 본(교체).
> 기존 마이그 `20260611180000_closing_revenue_read_lock` = **WITHDRAWN(.sql.WITHDRAWN), 운영 적용 금지.**
> 교체본 = `20260611200000_closing_workflow_read_canonical`.

- prod: rxlomoozakkjesdqjtvd
- 작성: dev-foot, 2026-06-11
- 출처: 김주연 총괄 직접 정정 (일마감 ≠ 매출집계). planner NEW-TASK MSG-20260611-190005-791n.
- 우산: T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY WS-2 집행 child (D-7 verdict SUPERSEDE)
- 마이그: `supabase/migrations/20260611200000_closing_workflow_read_canonical.sql`
- 롤백:  `supabase/migrations/20260611200000_closing_workflow_read_canonical.rollback.sql`
- dry-run: `scripts/T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN_dryrun.mjs` → **PASS**
- FE: `src/App.tsx`(closing RoleGuard) + `src/lib/permissions.ts`(PERM_MATRIX.closing) + `src/components/AdminLayout.tsx`(nav) — 3-gate 파리티(전직원 8역할, tm 제외)
- ★ daily_closings + closing_manual_payments 2 테이블만. SELECT over-open(true)→canonical 만. 일마감 수행 role 잠금 0. 쓰기 미접촉 ★

## 분류 실측 (FE 라우트·쿼리·스키마 근거 — 추정 아님)
| 구분 | 테이블/뷰 | FE 위치 | 정책 |
|------|-----------|---------|------|
| **일마감 (daily closing workflow)** | `daily_closings`, `closing_manual_payments` | `/admin/closing` (`src/pages/Closing.tsx`, 화면 제목 "일마감"; daily_closings 직접 insert/update) | **OPEN** (전직원 8역할, tm 제외) |
| **매출집계 (실장별·치료사별 성과)** | `payments`, `package_payments`, `package_sessions` (직접 집계) | `/admin/sales` (`src/pages/Sales.tsx`, SalesStaffTab/SalesTreatmentTab/SalesDoctorTab) | **EXCL** (admin/manager) — 본 티켓 무관, 이미 직원 숨김 |

→ daily_closings/closing_manual 은 **매출집계 '뷰'가 아님**. Sales(매출집계)는 이 두 테이블을 **쿼리하지 않음**(`.from()` grep 0건). 일마감 workflow 테이블에 '매출집계' LOCK 적용은 오적용 → 일마감 수행 직원 차단(NAV-BOUNCE).

## 일마감 수행 role (현장 기준)
전직원 **8역할(tm 제외)** = `ALL_STAFF_ROLES` (admin/manager/director/consultant/coordinator/therapist/part_lead/staff).
근거: 총괄 "일마감=직원 업무=staff OPEN" + 기존 `daily_closings_staff_read = is_floor_staff()`(staff/part_lead 접수·안내 열람, T-20260520-foot-STAFF-DAILY-READ) + finance(consultant/coordinator). tm = 최소권한(STAFF-ROLE-TM-ADD 4메뉴) → 메뉴 제외.

## NAV-BOUNCE RC (3-gate 불일치)
| gate | LOCK 이전(prod) | LOCK 후 | 정정 후 |
|------|------|------|------|
| AdminLayout nav | admin/manager/consultant/coordinator/therapist | (미수정, 그대로) | **8역할(tm 제외)** |
| PERM_MATRIX.closing | admin/manager/director/consultant/coordinator/therapist/part_lead | admin/manager/director/consultant/part_lead | **ALL_STAFF_ROLES** |
| App.tsx route | admin/manager/consultant/coordinator/therapist | admin/manager/consultant | **8역할(tm 제외)** |

→ 세 게이트가 서로 달라, 메뉴 보이는 role(coordinator/therapist)이 route 에서 튕김 = NAV-BOUNCE. staff 는 RLS(is_floor_staff)는 read 허용인데 FE 3-gate 전부 제외 = 직원이 일마감 진입 불가. **3-gate 동일 집합으로 정렬해 해소.**

## DB 수정 (over-open 제거 = 보안 하드닝만, role 잠금 0)
```
daily_closings:
  daily_closings_read   true → (is_approved_user() AND clinic_id = current_user_clinic_id())   ← over-open만 제거(canonical clinic-scoped)
  finance_read (coordinator 포함) / staff_read(is_floor_staff) / therapist_read  = 유지(삭제·축소 안 함)
closing_manual_payments:
  closing_manual_read   true → (is_approved_user() AND clinic_id = current_user_clinic_id())   ← over-open만 제거
```
유지 효과: 본인 clinic 의 approved 전직원 read(일마감 parity). 제거 효과: 미승인 authenticated + 타 clinic 누수 차단(WS-2 보안).

## dry-run 결과 (트랜잭션 적용→검증→ROLLBACK, prod 영속 변경 없음)
```
회귀가드 자동 점검 (정정: over-open 제거 + 일마감 role OPEN 유지):
  daily_closings over-open(USING true) 제거              : ✅
  daily_closings_read canonical(approved+clinic) 전환    : ✅
  daily_closings therapist_read 유지(일마감 OPEN)        : ✅
  daily_closings finance_read coordinator 유지           : ✅
  daily_closings staff_read(is_floor_staff) 유지         : ✅
  closing_manual over-open 제거→canonical(approved+clinic): ✅
  AC-4 daily_closings 쓰기(ALL×2) 불변                   : ✅
  AC-4 closing_manual 쓰기(insert/update/delete) 불변    : ✅
→ DRY-RUN PASS
```

## AC 매핑
| AC | 충족 방식 |
|----|-----------|
| AC-3(정정) 일마감 role OPEN | finance(coordinator)/staff/therapist read 미축소 + FE 3-gate 전직원(8역할) 파리티 — 일마감 수행 role 잠금 0 |
| AC-5 clinic 스코프(보안) | over-open(true) → `clinic_id = current_user_clinic_id()` — 타 clinic 누수 차단(기존 IN(true) 대비 더 엄격) |
| AC-4 쓰기 불변 | daily_closings ALL×2, closing_manual insert/update/delete 미접촉(dry-run 검증) |
| AC-6 blanket-open 제거 | over-open(true) 제거 = 미승인 authenticated 차단. 신규 blanket-open 미발생 |
| 매출집계 EXCL 불변 | /admin/sales(payments 직접쿼리) route+nav admin/manager 유지(미접촉) |

## FE 정렬 (closing 3-gate 파리티 — 전직원 8역할, tm 제외)
- `src/components/AdminLayout.tsx` nav: `['admin','manager','consultant','coordinator','therapist']` → 8역할(tm 제외)
- `src/lib/permissions.ts` PERM_MATRIX.closing: `[...ALL_STAFF_ROLES]`
- `src/App.tsx` closing RoleGuard: `['admin','manager','consultant']` → 8역할(tm 제외)
- 매출집계(/admin/sales) nav+route = `['admin','manager']` 유지(미접촉). build OK(vite 3.69s).

## E2E
`tests/e2e/T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN.spec.ts` (4 tests: DC-1 over-open 제거+role 유지 / DC-2 closing_manual canonical / AC-4 쓰기 불변 / DC-FE 전직원 OPEN+tm 제외)

## 적용 절차 (supervisor)
1. ★기존 `20260611180000_closing_revenue_read_lock.*` = WITHDRAWN. 적용 금지.★
2. `supabase/migrations/20260611200000_closing_workflow_read_canonical.sql` 적용
3. 사후 검증:
   - daily_closings SELECT 에 qual='true' **0건**, daily_closings_read = `is_approved_user() AND clinic_id = current_user_clinic_id()`
   - therapist_read / finance_read(coordinator 포함) / staff_read = **존재(유지)**
   - closing_manual_read = canonical clinic-scoped
   - 쓰기 정책 불변
   - staff 계정 `SELECT count(*) FROM daily_closings WHERE clinic_id = current_user_clinic_id()` → 본인 clinic row 반환(deny 아님)
4. 회귀 시 rollback SQL (적용 시 over-open(true) 재발 — 보안 회귀)

## ★ E2E 재실행 (QA-FIX MSG-20260612-092633-y9vi — SUPABASE_ACCESS_TOKEN 설정 후) ★
> supervisor QA: DB 정책 검증 3건(DC-1/DC-2/AC-4)이 토큰 미설정으로 skipped → insufficient_verification.
> 조치: `SUPABASE_ACCESS_TOKEN`(~/.zshrc) export 후 재실행. **이제 skip 없이 실제 assert.**

### (1) 라이브 prod 대상 Playwright (2026-06-12, 토큰 설정)
```
DC-FE  전직원 OPEN+tm 제외 ............... PASS
AC-4   쓰기 정책 불변 .................... PASS
DC-1   daily_closings over-open 제거 ..... FAIL  ← prod 아직 over-open(true) (마이그 미적용)
DC-2   closing_manual over-open 제거 ..... FAIL  ← prod 아직 over-open(true) (마이그 미적용)
```
→ **DC-1/DC-2 의 FAIL 은 "검증 불충분"이 아니라 의도된 결과.** 가드가 prod 의 over-open(true) 잔존을 정확히 탐지(=vacuous 아님). 이 두 테스트는 **post-deploy 회귀가드** — 마이그 `20260611200000` 가 supervisor DB 게이트로 prod 적용된 직후에만 green. db_migration_pending=true 상태에선 정상적으로 RED.

### (2) post-migration 시뮬레이션 (트랜잭션 apply→assert→ROLLBACK, prod 무변경)
`node scripts/..._dryrun.mjs` → BEGIN 안에서 마이그 적용 후 DC-1/DC-2/AC-4 동치 가드 8종 점검:
```
daily_closings over-open(true) 제거 .................... ✅ (DC-1)
daily_closings_read canonical(approved+clinic) 전환 .... ✅ (DC-1)
daily_closings therapist_read 유지(일마감 OPEN) ........ ✅ (DC-1)
daily_closings finance_read coordinator 유지 ........... ✅ (DC-1)
daily_closings staff_read(is_floor_staff) 유지 ......... ✅ (DC-1)
closing_manual over-open 제거→canonical ................ ✅ (DC-2)
AC-4 daily_closings 쓰기(ALL×2) 불변 ................... ✅ (AC-4)
AC-4 closing_manual 쓰기(insert/update/delete) 불변 .... ✅ (AC-4)
→ DRY-RUN PASS  ↩️ ROLLBACK (prod 영속 변경 없음)
```
→ 마이그 적용 후 라이브 DC-1/DC-2/AC-4 가 모두 green 임을 트랜잭션으로 입증. (Management API 는 트랜잭션 미지원 → 라이브 apply-rollback 불가 → pg 직결 dryrun 이 게이트-전 정본 검증.)

### 잔여 단일 의존: supervisor DB 게이트 적용
- 라이브 DC-1/DC-2 green 의 유일 선결 = supervisor 가 `20260611200000` prod 적용. (dev-foot 금지: 운영 DB 스키마 변경은 supervisor 사전 승인.)
- 적용 직후 dev-foot 가 라이브 Playwright 즉시 재실행 → 4 tests full green 확인 예정.

## db_gate_status = (supervisor 판정 대기)
- RLS SELECT 정책 2건 over-open→canonical(clinic 스코프 추가 = 더 엄격). 데이터 무손실. 백필 없음. 쓰기 불변. 신규 컬럼/테이블/enum 없음(data-architect CONSULT 불요).
- 검증: 게이트-전 = dryrun 트랜잭션 PASS(post-migration 시뮬). 게이트-후 = 라이브 Playwright 4/4 (적용 직후 재실행).
