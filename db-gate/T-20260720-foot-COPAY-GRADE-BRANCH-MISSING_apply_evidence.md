═══ T-20260720-foot-COPAY-GRADE-BRANCH-MISSING  MIG 20260720193000 (ref=rxlomoozakkjesdqjtvd) ═══
시각: 2026-07-21 04:21:18 KST · mode=APPLY(실적용)
calc_copayment v1.5→v1.6 · ADDITIVE(CREATE OR REPLACE 동일 signature·7컬럼) · DA GO · forward-only(소급0).

## [BEFORE] prod calc_copayment 상태 (v1.5 기대)

### [BEFORE]
  · 함수 존재            : true
  · COMMENT             : 건보 본인부담 산출 v1.5 — 일반 정률경로(비-노인 general/low_income/medical_aid_2/infant…
  · COMMENT 'v1.6'      : false
  · 정액 IN 확장(v1.6)  : false  (medical_aid_1,low_income_2,medical_aid_2 LEAST)
  · low_income_1 면제    : false (rate 0.00)
  · medical_aid_2 정액   : false   (rate 0.00, 종전 0.15)
  · authenticated EXEC  : true  (true 기대)
  · anon EXEC           : false  (false 기대 — surface 증가 0)

## [DRY-RUN] dryrun_lib 무영속 harness (txn-strip → exception-handler → sentinel rollback)
  post-probe(함수 pre-exist → procAbsent 부적): v1.6 마커가 rollback 후 미영속(BEFORE=v1.5 유지)임을 실증.
  · dry-run 결과 = ✅ PASS
  · [POST-DRY 무영속 실측] v1.6 COMMENT 미존재=true · 정액IN확장 미존재=true ⇒ 무영속=✅

✅ DRY-RUN GATE 통과 (무영속 확인).

## [APPLY] 실적용 (applyMigration → DDL + schema_migrations 원장 기록)
  · 원장 pre: 20260720193000 등재=false
  · applyMigration 결과: {"version":"20260720193000","file":"20260720193000_calc_copayment_grade_flat_exempt.sql","name":"calc_copayment_grade_flat_exempt","applied":true,"dryRun":false}

## [POSTCHECK] prod 실측 (v1.6 기대)

### [POSTCHECK]
  · 함수 존재            : true
  · COMMENT             : 건보 본인부담 산출 v1.6 — 의원급 1차 외래 등급요율 교정: low_income_1 면제(0원 전용분기) / low_in…
  · COMMENT 'v1.6'      : true
  · 정액 IN 확장(v1.6)  : true  (medical_aid_1,low_income_2,medical_aid_2 LEAST)
  · low_income_1 면제    : true (rate 0.00)
  · medical_aid_2 정액   : true   (rate 0.00, 종전 0.15)
  · authenticated EXEC  : true  (true 기대)
  · anon EXEC           : false  (false 기대 — surface 증가 0)

  · 원장 post: 20260720193000 등재=true (3자 대조: 파일 존재 ✅ / 원장 ✅ / prod-def v1.6 ✅)

✅ POSTCHECK ALL-GREEN — calc_copayment v1.6 실적용 확인.
