# T-20260811-foot-PLANA-DAMDANGJA-PAY-SALES-VERIFY — verify evidence (read-only)

- ticket_kind: VERIFY / db_change: false / risk_verdict: GO (read-only live verify)
- reporter: 최필경 총괄 / assignee: dev-foot
- scope(잔여): 담당자 선택 후 플랜A(코밴 CAT) 결제 → **담당자별 매출** 집계 정상 반영 확인만.
  필드 정합(담당실장/내원경로/시술명)은 T-20260810-foot-PLANA-PKGPAY-BETA-PARITY-AUDIT(done, 0 divergence)로 旣해소 → 재감사 없음(AC-3 재인용 갈음).

## 결론 (VERDICT: PASS · 누락/오귀속 0)

플랜A(코밴 CAT) 결제는 **담당자별 매출 집계에 누락·오귀속 없이 산입**된다.
귀속축은 **결제 방식과 무관**하게 고객·내원 관계에서 파생되며, 어떤 담당자별 매출 surface도 CAT(플랜A) 결제를 배제하는 필터를 갖지 않는다.

## 1. 플랜A 결제 write 경로 (코밴 CAT → payments/package_payments)

`src/lib/cband/paymentFlow.ts` runPaymentFlow → APPROVED 분기 → `store.recordCardPayment`
`src/lib/cband/supabaseAttemptStore.ts` recordCardPayment / recordCatPackagePayment / recordCatPackageSplitPayment:

- check_in 단건 수납 → **payments** INSERT: `clinic_id`, `customer_id`, `check_in_id`, `amount`,
  `method='card'`, `payment_type='payment'`(취소=refund), `accounting_date`=승인일자(TRANDATE), `is_simulation`.
- 패키지 결제 → **package_payments** INSERT: `clinic_id`, `package_id`, `customer_id`, `amount`,
  `fee_kind='package'`, `payment_type`, `accounting_date`=승인일자, `is_simulation`.
- ★결제행에는 **판매시점 담당자(staff) 컬럼이 없다** — 결제 방식(플랜A/기존)과 매출 귀속은 물리적으로 분리.
  (external_approval_no/external_tid/payment_attempt_id 는 RedPay dedup·CAT-origin 판별용이지 귀속축 아님.)

## 2. 담당자별 매출 집계 귀속 경로 (고객·내원 attach → 결제 → 집계)

세 surface 전부 `payments`(+`package_payments`)를 **clinic_id + accounting_date 윈도우 + status≠deleted + sim 제외**
로만 조회 → **플랜A/CAT 배제 필터 없음**(payment_attempt_id/method/pg_provider 필터 부재, grep 0건).

| surface | 파일 | 소스 | 귀속축(WHO) |
|---|---|---|---|
| 매출집계 > 담당실장별 | `src/components/sales/SalesDoctorTab.tsx` | payments + package_payments | `customers.assigned_staff_id` (2번차트 담당실장, customer_id join) |
| 통계 > MTM 실장별 일별 | `src/lib/mtmSales.ts` fetchStaffDailyBreakdown | payments + package_payments | `customers.assigned_staff_id` (customer_id join) |
| 매출집계 > 실장(치료사) 실적/차감 | `src/components/sales/SalesStaffTab.tsx` | payments + package_sessions | `check_ins.therapist_id/technician_id` · `package_sessions.performed_by` |

- 세 경로 모두 귀속은 **고객카드/내원 관계**에서 파생 → **결제 방식(플랜A vs 기존) 무관**(BETA-PARITY-AUDIT 0 divergence 계승).
- customer_id 있고 `assigned_staff_id` 지정 → 해당 실장 버킷 정상 산입(누락/오귀속 0).
- `assigned_staff_id` NULL(또는 워크인 customer_id NULL) → **'미지정'** 버킷(오귀속 아님, 정상).
- sim 테스트금액(1001~1006)/테스트고객 → `excludeSimulationPaymentRows`로 매출 제외(오염 0).

## 3. AC 판정

- **AC-1 (결제내역 담당자 표기)**: PASS. 결제내역/담당실장별에 표기되는 담당자 = 고객카드 담당실장(assigned_staff_id).
  결제행 자체에 담당자 필드 없음 → 플랜A/기존 동일(회귀 0).
- **AC-2 (담당자별 매출 산입)**: PASS. 플랜A 결제행은 payments/package_payments 에 착지하고, 집계는 결제방식
  무필터로 읽어 assigned_staff_id 로 귀속 → 누락/오귀속 0. 그 담당자로 정상 산입.
- **AC-3 (내원경로·시술명 정합)**: 재인용 갈음. BETA-PARITY-AUDIT(done, A/B DB diff 0건) 결과 그대로 유효(재감사 불요).

## 4. '미지정' 원인 (reporter 실측 설명)

reporter 테스트 시 '미지정' 표시 = **결제 방식 결함이 아님**. 담당실장별 매출의 귀속축이 `customers.assigned_staff_id`
이므로, 해당 고객에 담당실장이 지정되지 않은 상태(assigned_staff_id NULL)에서 결제하면 '미지정' 버킷으로 잡힌다.
→ reporter 가정('담당자 미선택')과 정합. 담당실장을 지정(접수/상담 단계에서 배정)하고 결제하면 그 실장으로 정상 집계.
결제 미니창의 담당자/판매자 선택(seller_staff_id=화장품 판매귀속)은 담당실장별 매출 축(assigned_staff_id)과 별개 축이다.

## 5. 코드 변경

없음(read-only verify, 결함 미발견). 집계 결함 미발견으로 fix 별건 분번 불필요.

## 6. 현장 회신 요약 (responder 경유 reporter)

담당자별 매출은 결제 방식(플랜A/기존)에 상관없이, 그 고객의 '담당 실장'(고객카드에 지정된 담당자)을 기준으로
매출을 모읍니다. 플랜A로 결제해도 매출이 빠지거나 다른 사람에게 잘못 잡히지 않습니다. 테스트 때 '미지정'으로
보였던 건 결제 방식 문제가 아니라, 그 고객에게 담당 실장이 아직 지정되지 않았기 때문입니다(담당 실장을 먼저
지정하고 결제하면 그 실장 매출로 정상 집계). 담당자/내원경로/시술명 칸이 기존과 똑같이 채워지는지는 8/10 확인
(어긋난 항목 0건)으로 이미 확인됐습니다.
