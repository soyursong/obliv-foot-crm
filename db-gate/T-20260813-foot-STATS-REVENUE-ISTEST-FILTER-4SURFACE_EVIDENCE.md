# T-20260813-foot-STATS-REVENUE-ISTEST-FILTER-4SURFACE — 증적 (apply-gated)

- **repo**: obliv-foot-crm  ·  **DB**: rxlomoozakkjesdqjtvd (foot 단일 Supabase / prod)
- **artifact-class**: `db_only` (백엔드 view/RPC 필터 · FE 번들 0 · e2e exempt)
- **부모**: T-20260812-foot-TESTDATA-PRE0713-ISTEST-BACKFILL (215 is_test 백필). 본건 = 매출/통계 완결 leg.
- **DA**: MSG-20260812-194644-zwq7 (is_test on customers = CANONICAL 필터축). 신규 CONSULT 불요 · ADDITIVE · §3.1 대표게이트 면제.
- ★**GO-token 前 prod apply 0** (apply_before_go 준수). 순서 권장 = 부모 215 백필 apply 後.

## STEP1 — LIVE prod 실조회 (pg_get_viewdef / pg_get_functiondef · READ-ONLY)

`scripts/T-...-4SURFACE_step1_introspect.mjs`

| # | surface | 성격 | 조사 전 필터 | customer-join 축 | 워크인 처리 |
|---|---------|------|--------------|------------------|-------------|
| 1 | `foot_stats_revenue` (RPC) | /admin/stats 매출 | `is_simulation` NOT EXISTS 만 (★is_test 미필터) | `payments.customer_id` / `package_payments.customer_id` (NOT EXISTS 상관) | NOT EXISTS → customer_id NULL 보존 |
| 2 | `v_daily_avg_spend` | 매출/객단가 | ★양축 미필터 | 미조인 → `payments/package_payments.customer_id` 로 신규 LEFT JOIN | LEFT JOIN NULL 보존 |
| 3 | `v_monthly_therapist_perf` | 월 치료사 매출 | ★미필터 | 미조인 → **`check_ins.customer_id` 실재 확인** → 신규 LEFT JOIN | LEFT JOIN NULL 보존 |
| 4 | `v_monthly_consultant_perf` | 월 상담사 매출 | ★미필터 | 미조인 → `check_ins.customer_id` 로 신규 LEFT JOIN | LEFT JOIN NULL 보존 |

- `customers.is_test` / `is_simulation` 컬럼 실재 CONFIRMED (boolean, default false, nullable).
- `check_ins.customer_id` / `payments.customer_id` / `package_payments.customer_id` 전부 실재 → **4 surface 전부 join축 확보** (planner 재보고 불요 · blanket 회피).

## STEP2 — 필터 배선 (CREATE OR REPLACE · 무DROP · 시그니처 불변)

`supabase/migrations/20260813150000_foot_stats_revenue_istest_filter_4surface.sql` (+ `.rollback.sql`)

- **#1 RPC**: 기존 NOT EXISTS 술어에 `OR c.is_test IS TRUE` 추가 (최소 diff). 시그니처 `foot_stats_revenue(uuid,date,date) RETURNS TABLE(dt,package_amount,single_amount,refund_amount)` 불변.
- **#2/#3/#4 VIEW**: canonical `v_daily_revenue` 패턴 미러 = `LEFT JOIN customers` + `NOT COALESCE(cu.is_test,false) AND NOT COALESCE(cu.is_simulation,false)`. 출력컬럼 시그니처 불변.
- 워크인(customer_id NULL): LEFT JOIN → cu.* NULL → COALESCE(NULL,false)=false → NOT false = true → **보존**. INNER JOIN 미채택.
- reloptions / GRANT 무변경. 테이블·데이터 변경 0.

## STEP3 — READ-ONLY 검증

### (가) 부모 apply 後 예상 매출 델타 (pre-0713 test set = 부모 is_test 대상)
`scripts/T-...-4SURFACE_step3_delta_verify.mjs`

| 축 | net 감소 (테스트고객만) | 워크인 net | 실고객(post-0713) net |
|----|------------------------|-----------|----------------------|
| payments (단품) | **−2,175,230** (82행) | 0 (보존) | 0 (무영향) |
| package_payments (패키지) | **−18,510,010** (20행) | 0 (보존) | 0 (무영향) |
| check_ins-grain (#3/#4) | **−779,490** (173 check_ins) | 0 (보존) | 0 (무영향) |

- **`is_simulation` net = 0** (모든 surface · 현 sim 5건 무매출) → is_simulation 양축 추가 = 순수 안전벨트(델타 0). 델타 = **오직 pre-0713 테스트고객분** = 부모 freeze 215 셋과 정합.
- 워크인 net 감소 0 · 실고객 net 감소 0 → "정확히 테스트고객 매출분만 감소" assert PASS.

### (나) no-persistence dry-run
`supabase/migrations/20260813150000_..._4surface.dryrun.mjs` (`/tmp/foot_4surface_dryrun.log`)

- **(A) 파싱/유효성**: 4 CREATE OR REPLACE 를 `BEGIN…ROLLBACK` 로 감싸 실행 → 에러 0 (유효), ROLLBACK 무영속. **PASS**
- **(B) 델타 정합** (현 is_test 상태 = 부모 apply 前, 5건만 flagged):
  - #2 v_daily_avg_spend: net 489,692,160→489,692,160 (현 무매출 test 제외, count 1216→1204)
  - #3 v_monthly_therapist_perf: net 15,829,040→15,829,040 (count 778→775)
  - #4 v_monthly_consultant_perf: net 9,742,770→9,742,770 (count 832→830)
  - #1 payments: pay −29,400 / ref −29,400 (자기상쇄 test 결제, net 0) · package_payments: pay −5,920,000 / ref −5,920,000 (net 0)
  - → 현 시점 net delta ≈ 0 (현 flagged 5건은 자기상쇄 test 항목). **대형 델타는 부모 215 apply 後 발현** (위 (가) 표).
- **(C) 무영속 증명**: 실행 후 live def 재조회 → 4 surface 전부 `is_test` 미포함 = **prod 무영속 CONFIRMED**.

## MIG-GATE

- `mig_files`: 20260813150000_foot_stats_revenue_istest_filter_4surface.sql (+ .rollback.sql + .dryrun.mjs)
- `mig_dryrun`: no-persistence PASS (A/B/C 상기). prod write 0.
- `mig_ledger_check`: prod 최신 = 20260812234000. 20260813150000 = 최신 · 넘버링 충돌 0 · 부모 20260813120000 미적용(apply-gated)보다 뒤 → 순서 정합.
- `mig_rollback`: 2-leg 불요(데이터 무변경). `.rollback.sql` = 4 surface 를 필터 이전 LIVE 정의로 CREATE OR REPLACE 즉시 역전.

## 잔여 게이트 (supervisor 집행)

1. DDL-diff QA + deploy-precheck (C11 prod-schema 실재 · C19 RPC body-drift · C0/C2/C4).
2. DB-GATE **GO-token 발행 후에만** prod apply. GO-token 前 prod CREATE 금지.
3. 순서: **부모 215 백필 apply 後** 본 마이그 apply (테스트고객 is_test=true 실재해야 필터 효과 발현).
4. post-apply: schema_migrations 20260813150000 원장 등재 + POST-VERIFY(live def is_test 포함 확인 + 매출 델타 재측정).
