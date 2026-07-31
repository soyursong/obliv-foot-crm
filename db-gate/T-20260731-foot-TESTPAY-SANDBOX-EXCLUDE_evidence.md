# T-20260731-foot-TESTPAY-SANDBOX-EXCLUDE — DB 검증 evidence

`is_simulation` physlink ARMING (money-grain 제외축). DA GO(ADDITIVE). prod ref=rxlomoozakkjesdqjtvd, Management API.
mig=`supabase/migrations/20260731113000_foot_testpay_sandbox_exclude_is_simulation.sql`. e2e_spec_exempt=db_only(검증 면제 아님 → 아래 실측).

## 1) No-Persistence dryrun (sentinel unwind)
```
DRYRUN RESULT: ALL PASS
(1) 3-grain 컬럼(boolean NOT NULL DEFAULT false): PASS
(2) stamp 함수 SECDEF+search_path: PASS
(3) 3-grain sim-stamp 트리거: PASS
(4) 제외필터(source 1conj + insurance 3conj): PASS
```
post-probe(별 read-only 세션, apply 전): cols=0 / triggers=0 / stamp_fn=0 / src_filter_pos=0 → 무영속 확정.

## 2) apply POSTCHECK (prod 실재)
- 컬럼: payments/service_charges/package_payments.is_simulation = boolean, is_nullable=NO, default=false (3/3)
- 트리거: trg_{payments,service_charges,package_payments}_sim_stamp_insert (BEFORE INSERT, 3/3)
- stamp fn: prosecdef=true, proconfig=[search_path=public, pg_temp]
- 제외필터 conjunct: closing_source_split=1, closing_insurance_split=3 (net p + is_ins EXISTS sc + covered sc)
- ledger: supabase_migrations.schema_migrations version=20260731113000 등재 (3자 정합: 파일↔prod↔원장)

## 3) 무회귀 실증 (AC4) — clinic 74967aea, apply 전 baseline == apply 후
| date | source(total/ad/organic) | insurance(total/copay/nonins/covered) |
|------|--------------------------|----------------------------------------|
| 2026-07-28 | 8426360 / 934680 / 7491680 | 8426360 / 6698760 / 1727600 / 208345 |
| 2026-07-27 | 1128280 / 70200 / 1058080  | 1128280 / 108280 / 1020000 / 254392  |
| 2026-07-30 | 1498300 / 87000 / 1411300  | 1498300 / 106300 / 1392000 / 196422  |

apply 전/후 3일 전부 **완전 동일** → 컬럼+필터 add = no-op(전원 is_simulation=false, 소급 backfill 無). money-grain sim=true 건수=0(dormant, forward-only).

## 4) 행동검증 (stamp write-path) — RAISE 무영속 롤백
- 테스트고객(customers.is_simulation=true) payment INSERT → is_simulation **t** (자동 각인)
- 정상고객 payment INSERT → is_simulation **f** (DEFAULT 보존)
- 정상고객 + 명시 is_simulation=true INSERT → **t** 보존 (fail-open, 명시값 미덮어씀)
- 드롭 실증: 테스트+정상 각 1건 동일일자 INSERT 후 closing_source_split total=**88888**(정상만) → 테스트수납(99999, stamp true) 매출 split에서 제외
- 잔여: 2099-01-01 테스트행 count=0 (롤백 무영속 확정)

## 5) rollback
`supabase/migrations/20260731113000_..._is_simulation.rollback.sql` — split 함수 pre-filter 복원 + 트리거/함수 drop + 인덱스/컬럼 drop(역순). ⚠컬럼 drop 파괴적(값 소실), sim forward-only라 현 소실=0.
