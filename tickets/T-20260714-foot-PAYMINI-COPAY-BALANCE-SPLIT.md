---
id: T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT
domain: foot
priority: P0
hotfix: true
status: deploy-ready
qa_result: pass
deploy_commit: e14557269b23
deployed_at: n/a (NOT yet deployed — supervisor QA/bundle 검증 대기)
bundle_hash: PaymentMiniWindow-CMF_IKZ_.js / index-Dn3lhecX.js (로컬 build 산출 — supervisor 운영배포 후 재검증)
db_change: false
db_migration: none
db_gate: N/A (Part1 read-side, 스키마 무의존 — 신규 컬럼/테이블/enum 0, DA CONSULT 불요. 저장처 확정은 Part2 별도)
build: pass (npm run build ✓ built in 5.47s)
scenario_count: 3
e2e_spec: tests/e2e/T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT.spec.ts
spec: tests/e2e/T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT.spec.ts
created: 2026-07-14
completed:
assignee: dev-foot
owner: agent-fdd-dev-foot
reporter: planner (NEW-TASK MSG-20260714-115235-gp52)
slack_thread:
part2_followon: 공단부담금 별도 정보성 라인 표시 + 저장처 확정 — DA CONSULT-REPLY 수신 後 착수(본 티켓과 통합 배포 가능)
---

# T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT — 결제 미니창 수납잔액 급여 본인부담금 split (Part1)

## 요청 (P0 HOTFIX, 김주연 총괄)
급여환자 수납 시 결제 미니창(PaymentMiniWindow) **수납잔액**이 공단부담금까지 합산돼 환자에게
과청구됨. 오늘 전 급여환자 수기 등록 중(운영 중단 수준). 오늘 배포 목표.

## Part1 (완료 — 스키마 무의존, read-side)
**수납잔액 = 급여 본인부담금(copayment) + 비급여 전액.** 공단부담금(is_insurance_covered 커버분) 합산 **제거**.

예: 급여 30,000(본인+공단) + 비급여 5,000
- general 30% → 본인 9,000 / 공단 21,000 → **수납잔액 = 9,000 + 5,000 = 14,000** (공단 21,000 제외)
- grade=null(미입력/조회실패) → 본인 = 급여전액 30,000 / 공단 0 (DOCPRINT-RECUR) → **수납잔액 = 35,000**

## 구현 (src/components/PaymentMiniWindow.tsx)
1. 세금구분/급여합/본인부담금 산출을 **배포된 SSOT `computeFootBilling`(8239350e, DOCPRINT-RECUR) 재사용**으로
   일원화. PMW 인라인 재계산(grade=null 시 copayment=0 으로 SSOT와 divergence 하던 병렬 경로) 제거 —
   qa-fail 근거였던 병렬 계산 경로 신설 회피.
2. `payableTotal = footBilling.copaymentTotal + footBilling.nonCoveredTotal` 신규 파생.
3. 수납 amount(handleSettle / handleDocAndSettle) + displayAmount(수납 버튼/분할/split) → `payableTotal`.
4. 결제란 하단 볼드 라벨 "합계" → "수납잔액"(payableTotal). 세금구분(급여/비급여)·급여자부담 라인 불변.

### 무접촉 (Part2 / 문서 축)
- 서류 total_amount/subtotal_amount/공단·본인 split 표기(applyBillingFallback / bill_detail) = 총진료비 기준 그대로.
- 공단부담금 별도 정보성 라인 + 저장처 확정 → **Part2 (DA CONSULT-REPLY 수신 後)**.

## QA (dev self)
- E2E: 6/6 PASS — 시나리오1 급여환자(general) / 시나리오2 비급여만 회귀 / 시나리오3 grade=null 엣지 + 버그가드 2건.
- 회귀: DOCPRINT-INSURANCE-SPLIT-RECUR / COPAY-MINI-BUG / RECEIPT-ITEMIZED / PMW-SPLIT-PAYMENT = 44/44 PASS.
- build: pass.
