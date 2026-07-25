# T-20260725-foot-SURCHARGE-SERVICECHARGE-PERSIST-POLICY — MIG-GATE + sample 1행 실증

**정본**: `revenue_insurance_split_spec.md §2-2-7 (v1.21)` + `da_decision_foot_surcharge_servicecharge_persist_policy_20260725.md`
**verdict**: DA GO Option B(going-forward 영속·ADDITIVE). §3.1 대표 게이트 면제 → supervisor DDL-diff/QA.

## 변경 (ADDITIVE 함수 시그니처 확장, 신규 테이블/컬럼 0)
- `calc_copayment` v1.6(4-arg) → **v1.7(5-arg, `p_surcharge_rate NUMERIC DEFAULT 0`)**. 가산 반영 base = `ROUND(hira_score × hira_unit_value × (1 + rate))`. rate=0 → v1.6 byte-identical.
- `record_insurance_consult_payment` v1(6-arg) → **v2(7-arg, `p_surcharge_rate DEFAULT 0`)**. 진찰료(`hira_category='consultation'`) 급여건에만 self-gate 반영(이중계상 가드). calc_copayment 가산 반영 base 를 명세+FK-copay 양쪽 동일 산출로 기록. engine ver `consult_writepath_v2`.
- FE `PaymentMiniWindow.tsx`: RPC 호출에 `p_surcharge_rate = settleSurchargeKind ? SURCHARGE_RATE : 0` 전달(가산 판정 SSOT = 07458cf6 detectSurchargeKind 재사용).

## MIG-GATE
- **mig_files**: `supabase/migrations/20260725180000_foot_consultfee_surcharge_servicecharge_persist.sql`
- **mig_dryrun**: PASS — dev-isolation(kcdqtyivtqcjmcrdjkqi) BEGIN/apply/ROLLBACK. up.sql 내 txn 제어문(BEGIN/COMMIT) 미포함 → 외부 트랜잭션 무영속 리허설 유효.
- **mig_dryrun_postprobe**: PASS(무영속) — ROLLBACK 후 dev-isolation calc_copayment=4-arg(PRE 복원)·record_insurance_consult_payment 부재 실측(누출 0).
- **mig_ledger_check**: dev-isolation PRE(4-arg/RPC 부재) → POST(5-arg/7-arg) → ROLLBACK PRE 복원. prod schema_migrations 등재·PROD DDL apply = supervisor 소관(dev_ops_policy §운영: dev-foot prod DDL=❌, ADDITIVE는 supervisor DDL-diff).
- **mig_rollback**: `supabase/migrations/20260725180000_foot_consultfee_surcharge_servicecharge_persist.rollback.sql` (calc_copayment v1.6 / RPC v1 복원, going-forward 전용·기존 행 무접촉).

## sample 1행 실증 (0722 조건2/3 계승) — 실 prod 값 진찰료(초진) score=153.36, uv=95.6

| case | base(rate=0) | base(rate=0.3) | copay | covered | 판정 |
|---|---|---|---|---|---|
| general calc_copayment | 14661 | **19060** = ROUND(153.36×95.6×1.3) | 5700 | 13360 | base×1.3 PASS · split base==copay+covered PASS |
| general RPC service_charges | — | 19060 | 5700 | 13360 | base_amount=base×1.3 PASS · payment.amount==SC.copay(**AC-3 parity**) PASS |
| null-grade RPC service_charges | — | 19060 | 5700 | **0** | **AC-1 covered=0**(phantom NHIS 공단 날조 금지) PASS · copay=잠정30%가산 5700(payment 일치) |

- **가산 leg** (general): covered +2999 / copay +1400 (base leg 14661→19060 위 §2-2 grade-keyed split 1회 산출, AC-2 권위 재사용).
- **멱등**: 동일 check_in+service 재호출 → 2nd `idempotent_hit=true`, service_charge 중복 0 (재프린트·재정산 가드).
- **회귀 가드**: rate=0(평일 주간) base=14661 == ROUND(153.36×95.6) = v1 동일 → 회귀 0.
- **self-gate(이중계상 가드)**: 처치(`hira_category='procedure'`)에 rate=0.3 전달해도 base=14661(가산 미적용) — 진찰료+가산코드 grain 유지, 진료비 전체합산 아님(body canon).

원 로그: `db-gate/T-20260725-foot-SURCHARGE-SERVICECHARGE-PERSIST-POLICY_evidence.txt`

## 범위 경계
- foot 단일 도메인. cross-CRM(body/women/scalp2) sweep = 별건 non-blocking.
- B-소급 백필 = 별건 티켓(T-20260725-foot-SURCHARGE-SERVICECHARGE-BACKFILL). 본 티켓 going-forward only, 기존 행 UPDATE 0건.
