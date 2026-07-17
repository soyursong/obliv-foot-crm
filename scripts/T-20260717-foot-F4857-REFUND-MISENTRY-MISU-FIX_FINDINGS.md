# T-20260717-foot-F4857-REFUND-MISENTRY-MISU-FIX — Forensic Findings (READ-ONLY)

**작성**: dev-foot · 2026-07-17 · **status**: BLOCK (forensic 완료, apply 보류)
**대상**: 엘런 F-4857 (customer id `fa0dc73d-6e03-4b6f-8022-f6216539805d`, clinic `74967aea-...930bc8`)
**evidence**: `scripts/F4857_forensic_PRE.json` (반영 전 스냅샷)

---

## 1. 결론 요약 (⚠️ 티켓 전제와 사실 불일치)

- **미수 500,000 의 진짜 원인은 "실수 환불"이 아니라 "회수1 패키지 phantom 미수"다.**
- **순수납액은 이미 +500,000 으로 정상**이다. 티켓이 가정한 "순잔액 0"은 사실이 아님.
- 따라서 티켓의 우선안(ADDITIVE +500,000 보정수납)을 그대로 적용하면 **실수납이 1,000,000 으로 과다계상**된다 → **적용 금지**.

## 2. 원장 실사실 (payments 3행 + phantom package 1건)

| 시각(KST) | row id | type | amount | memo | 비고 |
|---|---|---|---|---|---|
| 17:46:21 | `f8f3ca8b` | payment | +500,000 | 영수증 수납(단건) | 최초 단건 결제 |
| 17:47:09 | pkg `38cfc0d4` | — | (total 500,000) | 회수1·paid_amount 500,000 | **package_payments 없음** |
| 17:47:27 | `662f6ecf` | payment | +500,000 | 영수증 업로드(회수1·단건) | **중복 결제** |
| 17:48:27 | `02a34435` | refund | −500,000 | **중복** | `linked_payment_id`→`f8f3ca8b` |

- payments 순액 = 500,000 + 500,000 − 500,000 = **+500,000** (정상).
- 환불(`02a34435`) memo = "**중복**" → 스태프가 중복결제를 **의도적으로 정정**한 것. "실수 환불" 아님.

## 3. 미수 500,000 의 산식적 규명

- 미수 배너 = `loadCustomerOutstanding` (src/lib/footBilling.ts) → `packages.total_amount − Σ(package_payments net)`.
- package `38cfc0d4`: total 500,000, **package_payments 전무** → net 0 → **pkg_due = 500,000** (phantom).
- 원인 코드: `CustomerChartPage.tsx:918-946` (T-20260610 PKGCLASS-SESSION1-SINGLE) —
  회수1 패키지 영수증 업로드는 `payments` INSERT + `packages.paid_amount += amt` 만 하고
  **`package_payments` 를 만들지 않는다.** 반면 미수 SSOT 는 `package_payments` 기준 → 상시 divergence.
  → 회수1 패키지를 영수증 업로드로 결제한 **모든 고객**에 동일 phantom 미수 발생 가능 (별도 systemic 티켓 후보).

## 4. 총괄 오인 경위 (왜 "환불이 실수"로 보였나)

- 살아남은 실결제 `662f6ecf` 는 memo 가 "**영수증 업로드**"로 시작 → `CHART2-RECEIPT-RESTRUCTURE` 필터로
  **2번차트 수납내역에서 제외**됨(결제영수증 섹션에만 표기).
- 수납내역 화면엔 `f8f3ca8b`(+500,000) 와 그 환불(−500,000)만 보여 **표면상 net 0** 처럼 보이고,
  거기에 phantom 미수 500,000 이 겹쳐 "환불이 실수, 50만원 받아야 함"으로 읽힌 것.
- **실제로는 `662f6ecf` 가 숨은 채 500,000 을 보유** → net 이미 +500,000.

## 5. 권고 remediation (apply 보류 — 게이트 필요)

미수 0 + net +500,000 + split 불변을 **동시** 만족하는 유일 경로 = **phantom 회수1 패키지 무력화**(archive-first).

- **A안(권고, split 불변·payment 무접점)**: package `38cfc0d4` 를 archive/비활성(status≠active).
  `loadCustomerOutstanding` 이 active 만 집계 → pkg_due 소멸 → **미수 0**. payment 행 0건 touch → net/​split 불변.
  F-4716 SINGLEPAY archive-first 선례(T-20260715) 준용.
- **금지**: 티켓 우선안 ADDITIVE +500,000 (과다계상). payments 재분류/이동(split 변동·destructive).

## 6. 게이트 (파괴적/원장정정 → approved 만으로 apply 금지)

- [ ] **총괄 confirm-relay (정정된 사실 기준)**: "환불은 중복정정으로 정상, 실수납은 이미 500,000, 미수는 phantom 패키지 artifact. phantom 패키지를 archive 처리해 미수만 0 으로 정리" 동의 필요.
- [ ] **data-architect CONSULT**: packages 원장 status 정정(Orphan/phantom archive-first SOP 적용) 승인.
- [ ] **supervisor DB-GATE**: prod DB 반영 게이트.
- [ ] 대상 freeze: package id `38cfc0d4-3d54-4d11-87ff-677493fa5307` 단건 지문 고정(단일 count 기준 금지).
- [ ] 반영 후 POST 스냅샷(`F4857_forensic_POST.json`) + net Δ=0 실증.
