# T-20260819-foot-COPAY-VISIT-GRAIN — MIG-GATE evidence (deploy-ready 전제 4필드)

- 티켓: T-20260819-foot-COPAY-VISIT-GRAIN — 본인부담금 방문(visit) grain 교정 (design A · ADDITIVE)
- 설계 권위: DA CONSULT-REPLY MSG-20260819-132529-kma1 (`da_decision_foot_copay_visit_grain_billing_contract_20260819.md`), planner NEW-TASK MSG-20260819-133915-szjo (un-block, revised §4=design A)
- commit: ea33b38beacfcb2a68ac75af2e9011fad6a6a100 (+ 본 dry-run 스크립트 커밋)
- db_change: **true** (신규 CREATE FUNCTION = DDL → MIG-GATE·물리 GO-token 대상. DDL-0 아님·강등 금지)
- artifact-class: **db_only** (+ 동반 web_fe: copayCalc/패널 방문 grain 소비 수렴)
- prod ref: rxlomoozakkjesdqjtvd (foot 운영)

## ① mig_files
- `supabase/migrations/20260819200000_foot_calc_visit_copayment_additive.sql` (378 L, ADDITIVE forward-only)
  - 신규 `calc_visit_copayment(UUID[], UUID, UUID, DATE, NUMERIC)` — 방문 grain server AUTHORITY 재산출 (footBilling.fillBillItemCopayment mirror)
  - `record_insurance_consult_payment` v3 (7-arg → 8-arg, `p_visit_service_ids UUID[] DEFAULT NULL` ADDITIVE)
- rollback: `supabase/migrations/20260819200000_foot_calc_visit_copayment_additive.rollback.sql` (136 L)

## ② mig_dryrun — 무영속(no-persistence) PASS
- 러너: `scripts/T-20260819-foot-COPAY-VISIT-GRAIN_dryrun.mjs` → `scripts/dryrun_lib.mjs` (표준 v1.0, 3요소 구조)
  - ① stripTxnControl: top-level txn-control `(none)` (마이그에 BEGIN/COMMIT 없음 — INV-5 clean)
  - ② plpgsql exception-handler EXECUTE → sentinel RAISE → implicit savepoint rollback = 진짜 무영속
  - ③ assertAbsent post-probe (dry-run 후 부재 실측 = persistence-leak 차단, INV-3)
- 결과 (2026-08-19, Management API POST /database/query, prod ref):
  ```
  == dry-run 20260819200000_foot_calc_visit_copayment_additive.sql ==
     stripped top-level txn-control (INV-5): (none)
     harness response: []                        ← 마이그 clean 실행 + 함수 body 검증 통과 (에러 시 FAIL)
     post-probe [proc public.calc_visit_copayment] absent? -> [{"absent":true}]
     post-probe [proc record_insurance_consult_payment(8-arg v3)] absent? -> [{"absent":true}]
     post-probe [ledger schema_migrations 20260819200000] absent? -> [{"absent":true}]
  == DRY-RUN PASS == (txn-control stripped · plpgsql exception-rollback · post-probe absent)
  ```
- 판정: 마이그 SQL 이 prod 스키마(parity) 대상 clean 적용 + plpgsql body 검증 통과 + 3오브젝트 사후 전부 부재 = **무영속 확증(no leak)**.

## ③ mig_ledger_check — 원장 3자 대조 (clean)
prod 실측 (Management API read-only introspection, 2026-08-19):
| 축 | 실측 | 판정 |
|----|------|------|
| schema_migrations `20260819200000` | ABSENT (`present=false`) | 미적용 = dry-run 무영속 정합 ✓ |
| prod `calc_visit_copayment` | ABSENT (`present=false`) | 신규 genuine ADD (충돌 0) ✓ |
| prod `calc_copayment` | PRESENT · args=`(p_service_id,p_customer_id,p_clinic_id,p_visit_date,p_surcharge_rate)` · **functiondef md5=`eb2637a4`** (`md5(pg_get_functiondef)`) · **prosrc(body) md5=`1d5d2837`** (`md5(prosrc)`) | 무접촉 baseline — 마이그 내 CREATE/ALTER/DROP 0건(read-only CALL만) ✓. **정정(2026-08-19T07:57Z, dev-foot 라이브 재실측)**: 구 기록 `body md5=eb2637a4` 은 실제로 **functiondef** md5 였음(라벨 오류). prosrc(body) md5 = `1d5d2837`. 둘 다 동일 미접촉 함수의 서로 다른 측정축 → **drift 아님**. supervisor GO-token PUSH 지적(prosrc 1d5d2837) 반영. |
| prod `record_insurance_consult_payment` | PRESENT · 7-arg(v2) | v3 8-arg 로 ADDITIVE 대체(DEFAULT NULL → 7-arg caller 무회귀) ✓ |
- 3자(원장 선언 ↔ prod 실재 ↔ 마이그 파일) divergence 0. calc_copayment body-drift 감시(C19) = 마이그가 calc_copayment 를 수정하지 않음(신규 calc_visit_copayment 가 v1.7 로직 verbatim mirror 내장) — supervisor C19 대조 대상.

## ④ mig_rollback
- `supabase/migrations/20260819200000_foot_calc_visit_copayment_additive.rollback.sql`
  - `DROP FUNCTION calc_visit_copayment(...)` + `record_insurance_consult_payment` v2(7-arg) 재생성(원복 완전)
  - ADDITIVE 롤백 = 소급 데이터 변경 0 (신규 오브젝트 제거만)

## 무접촉 assert (DoD#5 · footBilling)
- `footBilling.ts:473`(computeFootBilling)·`:1015`(fillBillItemCopayment) = commit diff 부재 = **무접촉 확증**.
- `calc_copayment` = in-place 무수정 존치(정률 per-item 견적/표시) · 회귀 0 (기존 3-spec 50 passed).

## ⚠ apply 순서 (db_change=true)
- Gate-B(DA) GO ≠ apply 허가. **supervisor DB-GATE GO-token(`db_apply_guard.sh` lane) 발행 후에만 prod apply**.
- GO-token 前 prod DDL/RPC 선집행 금지(apply_before_go). `applied_at` = GO-token 후 prod-apply 시 기입.
- deploy-ready 마킹 = 본 4필드(무영속 dry-run + 원장 3자)로 충족. POST-VERIFY = supervisor(의급 min(1000,총액)·노인 36594→10900·정률 회귀0·client↔server 동일값·footBilling 무접촉·소급0·resettle clean·재호출 no-op).
