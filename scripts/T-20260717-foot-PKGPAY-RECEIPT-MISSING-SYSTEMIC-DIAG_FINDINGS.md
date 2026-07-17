# T-20260717-foot-PKGPAY-RECEIPT-MISSING-SYSTEMIC-DIAG — READ-ONLY 진단 결과

- 실행: 2026-07-17 (READ-ONLY, DB write 0건)
- 스크립트: `scripts/T-20260717-foot-PKGPAY-RECEIPT-MISSING-SYSTEMIC-DIAG_diag.mjs`
- 스냅샷: `scripts/T-20260717-foot-PKGPAY-RECEIPT-MISSING-SYSTEMIC-DIAG_SNAPSHOT.json`
- 승격 출처: F-4857 forensic(엘런) → systemic 후보

---

## 1. 버그 write-path 전량 식별 (코드)

회수1(`total_sessions<=1`, `isSinglePaymentByCount`) 패키지 귀속 결제가 **`payments` INSERT +
`packages.paid_amount` 직접가산**만 하고 **`package_payments` 를 만들지 않는** 경로 2곳:

| # | 위치 | memo 서명 | 동선 |
|---|------|-----------|------|
| (1) | `src/pages/CustomerChartPage.tsx:918-946` (`handlePaymentConfirm` pkg: 분기) | `영수증 업로드(회수1·단건)` | 2번차트 결제영수증 업로드 |
| (2) | `src/pages/Packages.tsx:1822-1848` (`PackagePaymentAdd.save`) | `패키지 추가결제(회수1·단건)` | 패키지관리 추가결제 |

두 경로 모두 `T-20260610-foot-PKGCLASS-SESSION1-SINGLE`(회수1=단건, 매출 이중계상 방지) 규칙에 따라
**의도적으로** package_payments 를 피하고 paid_amount 만 갱신한다. 주석: *"payments 행은
package_payments 합계 밖 → paid_amount 에 직접 가산(미납 오표시 방지)"*.

> 회수≥2 및 checkin/single 귀속은 `recordManualPayment`(SSOT, `manualPaymentWritePath.ts`) 경유 →
> package_payments 정상 생성. 버그 아님.

## 2. RC — 파생 미수 SSOT가 단건분류를 무시

`footBilling.loadCustomerOutstanding` 는 pkg_due 를 **package_payments 만으로** 파생:
```
pkg_due = total_amount − Σsigned(package_payments WHERE fee_kind='package')
```
paid_amount 를 **읽지 않는다.** → 회수1 패키지(total_amount>0)는 결제되어도 package_payments 가
비어 `pkg_due = total_amount` 의 **phantom 미수**로 표시.

**핵심 모순 = 이중 파생 컨벤션.**
- package_payments 기반(→ phantom): `loadCustomerOutstanding` + 하위 8곳
  (Dashboard 배지 `:4558`, NewCheckInDialog `:112`, TreatmentStatusPanel `:255`,
  PaymentMiniWindow `:826`, Closing `:438`, PkgOutstandingBadge, PaymentDialog `:235`,
  CustomerChartPage `:6586/:7159`, Packages 상세 `:1558`)
- paid_amount 기반(→ 정상): Packages 목록 `Packages.tsx:156` = `computeOutstanding(total_amount, paid_amount)`

같은 패키지가 화면마다 미수/완납으로 갈리는 원인.

## 3. 오염 규모 (버그경로 지문 교집합 — 단일 count 금지)

| 계층 | 정의 | pkg | phantom 합 |
|------|------|-----|-----------|
| L0 loose | active·total>0·package_payments empty·pkg_due>0 | 86 | 142,997,000원 |
| ↑ | **단독 근거 금지** — '정말 미납'(회수≥2 분할결제 진행중) + 'phantom' 혼재 | | |
| L1 회수1 | L0 ∩ `total_sessions<=1` | 55 | 4,857,000원 |
| **L2 TIGHT** | **L1 ∩ paid_amount>0 ∩ 고객 버그서명 payments 보유** | **40** | **1,698,000원** |
| L1\L2 잔차 | 회수1 phantom형이나 버그서명 미보유(수동입력/실미납 의심) | 15 | 백필 제외·개별확인 |

- **phantom 미수 확정 = 40 pkg / ₩1,698,000** (전건 `paid_amount == total_amount` 완납).
- 서명 내역: `영수증 업로드(회수1·단건)` **40건** / `패키지 추가결제(회수1·단건)` **0건**
  (경로(2) 는 코드상 존재하나 prod 미발생 — 잠재 리스크로 동일 수정 필요).
- 대표 사례: 무좀체험권 10,000원 다수 + 오니코레이저 260,000, RB2(에센셜) 500,000(F-4857) 등.
- 역방향 오탐 0: 서명 payments 40명 전원이 phantom pkg 와 매칭(고아 서명 없음).

## 4. 근본수정 방향 (제안 — 본 티켓 apply 금지)

- **R1 (권장): 파생 미수가 단건분류를 존중.** package_payments 기반 파생부(loadCustomerOutstanding
  + 인라인 computeOutstanding 콜러)에서 `isSinglePaymentByCount(total_sessions)` 패키지는
  **paid_amount 를 net-paid 소스로** 사용(`pkg_due = total_amount − paid_amount`).
  footBilling SSOT 에 `effectiveNetPaid(pkg, rows)` 헬퍼 1개로 중앙화 → 8개 콜러가 채택.
  매출 split(single≠package revenue) 불변 유지. **write-path 는 UNCHANGED.**
- **R2 (비권장): 40건 package_payments 백필.** revenue-source-split 이중계상 유발
  (single 결제가 package 매출로 중복) → PKGCLASS-SESSION1-SINGLE 설계 위반. **기각.**

## 5. 기존 오염 백필 규모

- pkg_due 는 **파생값(저장 컬럼 없음)**, paid_amount 는 이미 정확 → **R1 코드수정 시 40건 전량
  자동 치유, 데이터 백필 0행.**
- 단, 다운스트림에 미수 **저장/집계 materialize** 소비자 발견 시에만 백필 필요(현재 미발견).
- **정정 실행/코드수정은 후속 티켓** (R1 코드 = 근본수정 티켓, 백필은 R1 채택 시 불요 →
  백필 SOP 게이트 대상 아님). F-4857 단건은 k7dl 게이트 별도 진행(L2 40건 중 마지막 행 = 포함).

## 6. 후속 제안

1. **근본수정 티켓 스핀오프**: footBilling `effectiveNetPaid` 회수1 폴백(R1) + 8콜러 정합.
   신규 컬럼/enum 없음 → data-architect CONSULT 불요(db_change=false).
2. write-path (1)(2) 는 수정 불요(설계대로) — 단 (2) 잠재발생 방지 위해 R1 이 두 경로 모두 커버함을 회귀 spec 에 명시.
