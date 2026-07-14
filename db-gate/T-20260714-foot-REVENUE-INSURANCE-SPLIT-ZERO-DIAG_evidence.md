# T-20260714-foot-REVENUE-INSURANCE-SPLIT-ZERO-DIAG — 진단 근거 (READ-ONLY)

- **대상 DB**: obliv-foot-crm (rxlomoozakkjesdqjtvd)
- **화면**: 매출집계 → 일일결산(발생기준 집계 + 수납수단별 집계) = `src/components/sales/SalesDailyTab.tsx`
- **증상**: 급여>본부금=0, 급여>공단청구액=0, 우측 수납수단별 급여 열=— (전 결제수단)
- **게이트 판정**: **하이브리드** — 화면에 표시된 오늘의 0/—는 **데이터 부재(정상)**, 그러나 그 이면에 급여 분류가 집계로 흐르지 못하는 **구조적 결함(버그)** 상존.

## Phase 1 조회 결과 (2026-07-14, 서울오리진점 clinic=74967aea…)

| 소스 | grain | 오늘 결과 | 역대 결과 |
|------|-------|-----------|-----------|
| `payments.tax_type` | 수납 | 5건 전부 `null` (합 8,900) | `tax_type='급여'` **0건** |
| `package_payments.tax_type` | 수납 | 13건 전부 `null` (합 7,870,000) | `tax_type='급여'` **0건** |
| `service_charges` (명세) | 명세 | 당일 계산 **0건** | 전체 2건, `is_insurance_covered=true` **0건** |

→ 오늘·역대 통틀어 급여(보험) 시술 데이터가 사실상 존재하지 않음. 오늘 결제는 전부 `tax_type=null` → 코드상 면세(비급여)로 귀속(화면 면세=8,268,900과 일치).

## 급여 분류 필드 특정 + 집계 소스 grain 대조

**집계(read) 측 — SalesDailyTab.tsx**
- 본부금(copay) `left.copay` = `payments`/`package_payments` 중 `tax_type='급여'` 합 (L206). → 소스에 `급여`가 한 번도 없어 항상 0.
- 공단청구액(claim) `left.claim` = **코드에서 상수 0 하드코딩** (L200, L226). `service_charges.insurance_covered_amount`를 **전혀 조회하지 않음**.
- 우측 급여 열 = `taxTypeToCol('급여')` 매핑(L52) — `tax_type='급여'` 행이 없어 전 수단 0 → "—" 표시.
- 집계는 `payments`/`package_payments`/`closing_manual_payments`만 조회. **`service_charges`(명세 grain) 미조회**.

**기록(write) 측 — PaymentMiniWindow.tsx**
- `executeAutoDone`의 `tax_type = taxType ?? null` (L1559).
- 호출부 L1680/L1990: `const taxType = deductMode ? '선수금' : null;` → **`tax_type`은 오직 `'선수금'` 또는 `null`로만 기록. `'급여'`는 절대 기록되지 않음.**
- L566의 `taxClass==='급여'` 분기는 서류(bill_detail/문서출력) 표시용이며 `payments.tax_type` 기록에 반영되지 않음.

## SSOT 대조 (Revenue Insurance Split)

- SSOT: **공단부담액은 EDI 무관하게 명세(`service_charges`) 기준 즉시 산출**. `payments`=수납 grain, `service_charges`=명세 grain 권위 경계.
- 현 집계는 명세 grain을 읽지 않고 수납 grain의 (기록조차 안 되는) `tax_type='급여'`만 봄 + 공단청구액 하드코딩 0 → **잘못된 grain 참조 = SSOT 위반**.

## 결론

1. **오늘 화면 0/— 표시 = 데이터 부재(정상)**. 급여(보험) 시술 0건이라 0 표시가 맞음.
2. **잠재 구조 결함(버그)**: 보험 시술이 실제로 발생해도 (i) write가 `tax_type='급여'`를 안 남기고, (ii) 공단청구액이 하드코딩 0이며 명세 grain을 안 읽음 → 급여가 영구히 집계에 안 잡힘. → **별도 후속 코드수정 티켓** 필요(집계 산식=SSOT 소유 → data-architect CONSULT 경유, P2→P1 상향 검토).

*(본 티켓은 진단·relay만. 코드 수정 없음.)*
