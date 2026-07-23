# T-20260723-foot-INSCONSULT-WRITEPATH-HIRACAT-NULL — 진단 evidence (dev-foot, read-only)

**타입**: investigation (db_change=false, read-only). 판정(divergence 실질오차 여부)은 DA 소관 — 본 문서는 fact/evidence만.
**probe**: `scripts/T-20260723-foot-INSCONSULT-WRITEPATH-HIRACAT-NULL_probe.mjs` (SELECT only, prod rxlomoozakkjesdqjtvd, 2026-07-23)

## 1. 코드 경로 대조 (PaymentMiniWindow.tsx)

| 축 | 원자 write-path | snapshot 폴백 |
|----|----------------|---------------|
| 함수 | `record_insurance_consult_payment` RPC (mig 20260715160000) | `snapshotCoveredServiceCharges` (L1820) |
| 발화 조건(client 필터) | `is_insurance_covered && hira_category==='consultation'` (L1929-1933) | `is_insurance_covered===true` (L1826), hira_category 무관 |
| service_charges | 생성 (calc_copayment 적재) | 생성 (calc_copayment 적재), engine=`pmw_checkout_snapshot_v1` |
| payments | copay payment **생성 + service_charge_id FK 링크** + tax_type NULL | **미생성** — copay 는 lump `splits[0].amount` plain payment(FK NULL, tax_type NULL)에 흡수 |
| 원자성/멱등 | 단일 트랜잭션 + advisory lock | best-effort, charge-only, forward-only |
| engine tag | `consult_writepath_v1` | `pmw_checkout_snapshot_v1` |

## 2. prod 실측 (probe 결과)

- **q1** 활성 급여서비스 5건(AA154·AA222·AA254·D620300HZ·M0111) **전부 hira_category=NULL**. `consultation`/`examination`/`prescription` 카테고리 행은 모두 `active=false`.
- **q1b** 유일한 `consultation` 서비스 = "진찰료 (초진)" (`active=false`, service_code=NULL) → 활성 pricingItem 매칭 불가.
- **q2** covered service_charges **11행 전부 `pmw_checkout_snapshot_v1`** (check_ins 6). `consult_writepath_v1` **0행**. (base 165,720 = copay 69,780 + 공단 95,940 ✓)
- **q3** snapshot charges 11건 **전부 링크 payment 0건**.
- **q4** payments 중 `service_charge_id` FK 채움 **0건** (plain 164건 tax_type=NULL, 선수금 21건).
- **q5** covered 방문 6건 전부: 명세 copay 총 69,780 존재 / FK 링크 payment 총 **0원**.

## 3. divergence 성격 (evidence 기반, 판정 아님)

- **원자 write-path 는 prod 에서 0회 발화** — 활성 consultation 카테고리 서비스가 없어 필터 항상 false. (dead path)
- **명세 grain(service_charges)**: 폴백이 공단(95,940)·본인(69,780)·base 를 `is_insurance_covered=TRUE` 로 적재 → §2-2 공단부담 소스는 **보존됨**.
- **수납 grain(payments)**: 급여 진찰료 본인부담 copay 는 FK NULL + tax_type NULL plain payment 에 흡수 → §2-1 v1.6 "급여 귀속 = service_charge_id FK" 축에서 **급여 본인부담이 payment grain 상 면세/비급여로 오귀속될 후보**.

→ 매출 급여칸 실질오차 여부는 **read-side split 산식이 축별로 어느 grain 을 권위로 쓰는지**에 전적으로 의존:
  - 급여 본인부담 칸이 **명세 grain(service_charges.copayment_amount)** 소스면 → 폴백 보존, 오차 0.
  - 급여 본인부담 칸이 **payment grain(FK 축)** 소스면 → **누락**(면세로 오귀속), 급여 본인부담 매출 과소.

이 축 권위 판정 = revenue_insurance_split SSOT (data-architect) 소유 → **DA CONSULT 로 위임**.

## 4. DA CONSULT 질문 (착수 1차 게이트)

1. 활성 급여서비스 hira_category=NULL 이 매출 split 산식(§2-1 급여/비급여, §2-2 공단부담)에 **실질오차**를 유발하는가?
2. 원자 write-path 미발화 → snapshot 폴백 경유가 급여칸에 **누락/중복/grain divergence** 를 만드는가, 폴백이 정합을 보존하는가? (특히 급여 본인부담 칸의 권위 grain)
3. hira_category 세팅이 필요하다면 권위값(예: 'consultation')과 대상 항목 셋은? (AA154/AA254=진찰 계열, M0111/처치 등)

## 5. 스코프 밖 (별도 게이트)

매출 데이터 정정(백필 / write-path 코드 수정 / hira_category 세팅)은 **DA verdict + 본 evidence 수렴 후 별도 게이트**. 본 티켓은 read-only 진단으로 종료.
