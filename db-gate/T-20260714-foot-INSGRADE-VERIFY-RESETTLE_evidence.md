# MIG-GATE evidence — T-20260714-foot-INSGRADE-VERIFY-RESETTLE (Phase1)

migration: `supabase/migrations/20260716220000_foot_insgrade_resettle_marker_and_rpc.sql`
change-class: **ADDITIVE** (payments 신규 nullable 마커 2컬럼 + CHECK allowlist + 부분 인덱스 + 신규 함수)
DA verdict: GO(조건부) — DDL ADDITIVE no-op → 대표 게이트 면제, supervisor DDL-diff만.

## mig_files
- up:       `supabase/migrations/20260716220000_foot_insgrade_resettle_marker_and_rpc.sql`
- dryrun:   `supabase/migrations/20260716220000_foot_insgrade_resettle_marker_and_rpc.dryrun.sql`
- rollback: `supabase/migrations/20260716220000_foot_insgrade_resettle_marker_and_rpc.rollback.sql`

## mig_dryrun (No-Persistence Protocol, dryrun_lib.mjs)
```
== DRY-RUN PASS == (txn-control stripped · plpgsql exception-rollback · post-probe absent)
   stripped top-level txn-control (INV-5): (none)
   post-probe [col_reason] absent? -> true
   post-probe [func_absent]  absent? -> true
```
→ 무영속 확인(롤백 후 컬럼·함수 prod 부재 실측).

## applied_at (DDL-ATOMIC — 실적용 + POSTCHECK)
- applied_at: **2026-07-16T13:11:57Z (22:11 KST)** via Supabase Management API `/database/query` (ADDITIVE, DA 대표 면제)
- POSTCHECK:
  - payments.resettle_reason ✔ / payments.resettle_confirmed_grade ✔
  - CONSTRAINT payments_resettle_reason_allowlist ✔ (CHECK allowlist governed-enum: `'insurance_grade_resettle'`)
  - FUNCTION resettle_insurance_grade(uuid, text, boolean, text) ✔ SECURITY DEFINER=true
  - INDEX idx_payments_resettle_reason ✔

## mig_ledger_check
- supabase_migrations.schema_migrations INSERT version=`20260716220000` name=`foot_insgrade_resettle_marker_and_rpc` ✔ (원장=prod 실재 정합)

## mig_rollback
- `20260716220000_foot_insgrade_resettle_marker_and_rpc.rollback.sql` — DROP FUNCTION + DROP INDEX + DROP CONSTRAINT + DROP COLUMN(2). 기존 데이터 무변경.

## 산식 검증 (calc_copayment authority, prod)
- 진찰료(초진) base = round(153.36 × 95.60) = 14,661
- medical_aid_2(15%): confirmed copay 2,200 / provisional(30%) 4,400 → **refund 2,200** (data_incomplete=false)
- general(30%): confirmed 4,400 = provisional 4,400 → **refund 0** (시나리오2)
- 불변식 환불액(2,200) ≤ 기징수(4,400) ≤ 실수납액 ✔

## E2E
`tests/e2e/T-20260714-foot-INSGRADE-VERIFY-RESETTLE.spec.ts` — 3 passed (setup + 시나리오1 refund / 시나리오2 차액0), 인증 세션 토큰 RPC dry-run.

## 게이트 잔여 (Phase1 범위 밖)
- **Layer2 MONEY(실 refund/추가징수 commit, p_dry_run=false)** = money_gate(대표·회계+총괄 confirm) 대기. UX moneyGateOpen=false 로 미리보기만.
- **Layer1 DATA 백필**(301/338 명세 재적재) = data_correction_backfill_sop 정통, DA+총괄 이중 ratification 대기.
