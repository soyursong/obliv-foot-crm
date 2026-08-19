# AC-6 census — 과거 교차수단 환불(환불행 method ≠ 원결제 method) 전수

- **티켓**: T-20260819-foot-REFUND-CROSSMETHOD-METHOD-INHERIT-FWDFIX (Phase B)
- **부모 RC**: T-20260819-foot-CLOSING-CASHSUM-REFUNDROW-100K-DROP (Phase A forensic, deploy-ready B-2)
- **GATE**: READ-ONLY — prod write/DDL 0. auth=Management API postgres(무RLS, silent 0-row 회피).
- **census 스크립트**: `scripts/T-20260819-foot-CROSSMETHOD-REFUND_AC6_census_readonly.mjs`
- **실행 시각(KST)**: 2026-08-19

## 방법론 (ground-truth = parent_payment_id 링크)

환불행과 원결제행을 **`parent_payment_id` 링크로 조인**하여 `원결제.method IS DISTINCT FROM 환불행.method` 인 건을 전수 추출. (날짜/금액 heuristic 매칭 아님 = false-positive 배제.)

- `package_payments`: refund 35건 중 **33건 parent-linked** (2건 orphan = T-20260815 phantom self-offset 2.96M쌍, 교차수단 아님·card/card).
- `payments`: refund 118건 중 **0건 parent-linked** ← ⚠ **refund_single_payment 가 parent_payment_id 를 미persist** → payments 원장은 parent 링크로 교차수단 판별 **불가**(측정 blind spot, 아래 §측정한계).

## 결과 — 확정 교차수단 환불 = **3건** (package_payments, parent-linked ground truth)

| # | 환불일(KST) | 금액 | 수단쌍(원결제→환불기록) | 고객 | net | 마감 수단별 desync |
|---|------|------|------|------|------|------|
| 1 | 2026-07-28 11:17 | 1,260,000 | **transfer → card** | 현은호 (=F4717) | 정상 | 카드 −1.26M 과차감 / 이체 미차감 |
| 2 | 2026-07-30 19:40 | 1,400,000 | **transfer → card** | 남정현 | 정상 | 카드 −1.4M 과차감 / 이체 미차감 |
| 3 | 2026-08-18 23:18 | 100,000 | **card → cash** | 이금득 (부모 primary) | 정상 | 현금 −100k 과차감 / 카드 미차감 |

- **공통**: 각 건 net(총합계) 정상 — 결제수단별 합계만 desync. 총 왜곡 규모 = 2.76M(수단간 재배치, 순증감 0).
- **수단쌍 분포**: transfer→card ×2, card→cash ×1.

### #1 현은호 = F4717 인스턴스 (지문)
07-20 패키지 판매를 **card 4,500,000 + transfer 1,260,000** 두 레그로 수납. 07-28 11:17 동시 환불 2행:
`4.5M card→card`(정상) + `1.26M transfer→card`(교차수단). → 한 번의 환불 액션에서 두 레그를 **모두 card 로 기록** = 원결제 레그 method 미승계의 전형. **T-20260805-F4717 = 이 건과 동일 자산·동일 RC(§13.1.C 조율 대상).**

## ⚠ 이전 census(4건)와의 divergence — 정직 수렴

- 티켓 v1.1(2026-08-19 09:33, FOLLOWUP MSG-20260819-092759-iq5a)은 **4건**으로 기록(4번째 = "07-28 8,800 cash→card").
- **재검증 결과: 4번째(8.8k cash→card)는 parent-linked ground truth 로 재현되지 않음.** package_payments 8,000~9,000 refund = 0건. payments 8,800 근처는 전부 card **payment**(환불 아님) + 07-15 8,900 card→card refund 1건뿐. **cash→card 8,800 환불 실재 없음.**
- ∴ 4번째는 이전 세션의 **date/amount heuristic false-positive 추정**. **확정 대상 = 3건.**
- **B-3 소급 대상 = 3행**(4행 아님). 大額(1.4M·1.26M) 2건 포함 = per-row confirm 신중.

## 측정한계 (payments 원장 blind spot — DA/planner 통지 대상)

`refund_single_payment` 은 환불행 INSERT 시 `parent_payment_id` 를 세팅하지 않음(118 refund 전건 NULL) → **payments 원장의 교차수단 환불 여부는 parent 링크로 판정 불가.** 본 census 3건은 **package_payments 원장 한정** ground truth. payments 원장 교차수단 실태는 별도 heuristic(check_in 단위 원결제 method 대사) 필요 = 후속 과제. B-1 fix 는 payments 원장(refund_single_payment)에도 parent 링크 persist + method 승계를 함께 검토해야 함.

## B-1/B-3 함의

- **B-1(근본fix)**: RPC 3종(`refund_package_payment`/`refund_package_atomic`/`refund_single_payment`) 모두 환불행 method 를 `p_method`(호출자 지정)로 기록·원결제 미승계 = 상시 재발 write-path. → DA CONSULT 로 강제승계 vs 지정유지+검증 택일.
- **B-3(소급 정정)**: 대상 3행. 각 행 per-row field-decision(물리 실지급 정오) + DA GO + 김주연 confirm + supervisor dry-run + archive-first SOP 게이트 후 착수. **현 시점 write 금지(BLOCK).**
