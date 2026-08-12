# T-20260812-foot-TESTDATA-PRE0713-ISTEST-BACKFILL — 1단계 CENSUS 증거 (READ-ONLY)

- **작성**: dev-foot / 2026-08-12
- **DB**: rxlomoozakkjesdqjtvd (obliv-foot-crm, foot 단일 Supabase / prod)
- **성격**: READ-ONLY census. **prod write 0** (UPDATE/DELETE/INSERT 없음). GO-token 前 apply 미실행.
- **컷오프 해석**: 대상 = 기준일 `created_at < 2026-07-13T00:00:00+09:00` (= 7/12 23:59:59 KST 까지 생성분)
- **스크립트**: `T-20260812-foot-TESTDATA-PRE0713-ISTEST-BACKFILL_census.mjs`
- **원시 출력**: `T-20260812-foot-TESTDATA-PRE0713-ISTEST-BACKFILL_census_out.json`
- **컬럼 존재 판정법**: non-head `select(col).limit(1)` → `42703 undefined_column` = 컬럼부재 (교차검증 완료)

---

## 결론 요약 (2개 구조적 블로커 — 확정 A/A 방식 그대로는 실행 불가)

티켓의 확정 방식 = **"is_test 플래그 처리(체크인·결제·패키지 전부)"**. census 결과 이 방식은 **현재 스키마·의미축과 배치**되어 그대로 실행 불가.

### 블로커 ① — is_test 컬럼 부재 (check_ins·payments·packages 등 대상 테이블 전건)

`is_test` 컬럼은 **오직 `customers` 테이블에만 존재**. 대상 grain 전부 부재:

| 테이블 | is_test | is_simulation | canonical 기준컬럼 |
|--------|:-------:|:-------------:|--------------------|
| check_ins | **부재(42703)** | 부재 | created_at |
| payments | **부재(42703)** | 존재 | created_at |
| packages | **부재(42703)** | 부재 | created_at |
| package_payments | **부재(42703)** | 존재 | created_at |
| service_charges | **부재(42703)** | 존재 | (자체 날짜컬럼 없음 → check_in_id 로 부모 상속) |
| customers | **존재** | 존재 | created_at |

→ 티켓 §1 step-1 gate 명문: **"컬럼 없이 UPDATE 불가. 부재 테이블 발견 시 즉시 planner 보고 → DA CONSULT(컬럼 신설 ADDITIVE, MIG-GATE)로 승격."** 컬럼 신설 = 신규 컬럼 = 데이터정책 자문 게이트(§S2.4) 대상 → dev 독단 진행 금지.

### 블로커 ② — 의미축 불일치 (semantic firewall: is_test ⊥ is_simulation)

foot CRM 의 **매출·통계 유니버스 제외축은 `is_simulation`** 이지 `is_test` 가 아님. 코드 증거:

- `20260731113000_foot_testpay_sandbox_exclude_is_simulation.sql`:
  > canonical 축 = is_simulation(money-grain self-state, 매출/감사 제외축). ★필수.
  > **is_test(customers-grain view-hide, 고객목록 숨김·매출무관)** 와 grain/write-path 상이 → co-set 위반 아님.
- `20260719140000_foot_stats_revenue_filter_sim_status.sql`: 매출 RPC 는 `is_simulation IS NOT TRUE` 를 유니버스로 잠금(payments/package_payments), customers.is_simulation 을 NOT EXISTS 로 참조.
- `20260805110000_foot_check_in_services_softvoid.sql`:
  > customers.is_simulation(고객그레인·매출유니버스 밖) ⊥ customers.is_test(고객그레인·view-hide)

즉 **`is_test=true` 를 뒤집어도 매출·통계에서 제외되지 않음** (is_test 는 고객목록 숨김 = "매출무관" 축). 티켓 DoD("통계·매출에서만 제외")를 실제로 달성하는 축은 **`is_simulation`**. 티켓 e2e_spec_note 의 헤지("is_test 필터가 매출·통계 뷰에 이미 적용돼 있으면 자동 반영 — 미적용 뷰 있으면 별건 surface")에 대한 census 답 = **매출·통계 뷰에 is_test 필터 미적용. 적용된 축은 is_simulation.**

두 축 모두 **데이터-정책(축·컬럼) 판정 = DA 소관.** dev-foot 는 확정된 A/A 방식을 독단 재해석하거나 컬럼을 독단 신설할 수 없음 → planner FOLLOWUP + DA CONSULT 승격.

---

## census 원시 수치 (READ-ONLY)

### 대상 row 수 (created_at < 2026-07-13 KST, 플래그 무관 전체)
| 테이블 | total | pre-cutoff(전체) | is_test 대상(false/NULL) | is_simulation 대상(false/NULL) | 이미 sim=true |
|--------|------:|-----------------:|:------------------------:|:------------------------------:|:-------------:|
| check_ins | 1112 | 153 | N/A(컬럼부재) | N/A(컬럼부재) | — |
| payments | 958 | 25 | N/A(컬럼부재) | 25 | 0 |
| packages | 652 | 33 | N/A(컬럼부재) | N/A(컬럼부재) | — |
| package_payments | 199 | 0 | N/A(컬럼부재) | 0 | 0 |
| service_charges | 477 | (기준컬럼 부재 — 부모 check_in 상속) | N/A(컬럼부재) | 미산출 | — |
| customers | 1899 | 218 | 215 (이미 true 3) | 214 (이미 true 4) | 4 |

> ※ 단일 count 기준 blanket UPDATE 금지(Data-Correction Backfill SOP §단일-count-금지). 위 수치는 규모 파악용. 실 대상셋은 freeze(id 목록 고정) 단계에서 판정근거 스냅샷과 함께 확정.

### 7/13 경계행 (7/13 00:00 ~ 7/14 00:00 KST) — **존재 → reporter 재확인 트리거 발화(non-moot)**
| 테이블 | 7/13 당일 행 수 |
|--------|---------------:|
| check_ins | 17 |
| payments | 3 |
| packages | 9 |
| package_payments | 2 |
| customers | 81 |

컷오프는 `< 7/13 00:00:00`(7/13 당일 제외)로 해석했으나, **7/13 당일 활동행이 다수 존재**하므로 "**7/13 이전**"이 7/13 포함인지 여부를 planner 경유 reporter(김주연 총괄) 재확인 필요(티켓 cutoff_interpretation §step-4).

---

## 경계/disjoint 확인
- 진행 중 **체험권 차감 정정 31건(7/14 이후)** 과 disjoint: 본건 컷오프 `< 7/13` → 교집합 0. 무접촉 확인.
- 원장 진료화면(진료대시보드/진료관리) 무접촉 — 데이터 정정, 의료화면 코드 무변경.

---

## dev-foot 권고 (판정권 = planner/DA, 아래는 census 기반 재료)

foot 에서 "테스트 데이터 매출·통계 제외" DoD 를 만족하는 canonical 축은 **`is_simulation`** (이미 매출·통계 뷰에 배선). 재확정 필요 사항:

1. **축 재확정 (DA)**: 확정 A/A "is_test" → foot 실제 제외축 `is_simulation` 으로 매핑할지, 또는 is_test 를 money-grain 에 신설(ADDITIVE)하고 매출·통계 뷰 필터를 is_test 로 확장할지. (전자가 기존 배선 재사용·무DDL·즉효. 후자는 컬럼 신설 + 다수 뷰 개정 필요 = 대공사.)
2. **컬럼 신설 여부 (DA CONSULT, ADDITIVE)**: check_ins/packages 에 제외 플래그가 필요한지 (두 grain 이 매출·통계 집계에 참여하는지 선행 확인). payments/package_payments/service_charges 는 is_simulation 기존 존재 → 신설 불요.
3. **테스트 데이터 식별 술어 (DA + reporter)**: "2026-07-13 이전 생성 전체"를 테스트로 간주할지, 아니면 특정 테스트 고객/계정 링크로 좁힐지. 현재 customers pre-cutoff 218건 중 이미 is_test 3 / is_sim 4 만 표시됨 → 나머지 대량을 일괄 테스트 처리 시 진성 초기 실데이터 오분류 위험(단일-count blanket 금지 원칙).
4. **7/13 경계 포함 여부 (reporter)**: 위 경계행 표 근거로 재확인.

→ 위 4건 확정 전까지 freeze/dryrun/migration 산출·prod UPDATE 보류. 본 단계 산출 = census 증거뿐(prod write 0).
