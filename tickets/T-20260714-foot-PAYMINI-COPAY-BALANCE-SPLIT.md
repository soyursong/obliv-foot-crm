---
id: T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT
domain: foot
priority: P0
hotfix: true
status: deploy-ready
qa_result: pass
deploy_commit: Part1 e14557269b23 + Part2 (통합 배포 — 아래 완료 commit)
deployed_at: n/a (NOT yet deployed — supervisor QA/bundle 검증 대기)
bundle_hash: PaymentMiniWindow-DI6vYvyk.js / index-Dy4cng-X.js (Part2 로컬 build 산출 — supervisor 운영배포 후 재검증)
db_change: false
db_migration: none
db_gate: N/A — DA CONSULT-REPLY(MSG-20260714-121317-pq2t) GO / db_change=false / 신규 컬럼·테이블·enum 0. 공단부담금 저장처 = 기존 canonical 컬럼 service_charges.insurance_covered_amount 재사용(DDL 없음). 대표·MIG·supervisor DDL-diff 게이트 전부 면제(§3.1).
build: pass (npm run build ✓ built in 5.58s)
scenario_count: 3 (Part1) + 4 (Part2) = 10 assertions
e2e_spec: tests/e2e/T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT.spec.ts
spec: tests/e2e/T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT.spec.ts
created: 2026-07-14
completed: 2026-07-14
assignee: dev-foot
owner: agent-fdd-dev-foot
reporter: planner (NEW-TASK MSG-20260714-115235-gp52 / Part2 언블록 MSG-20260714-121558-796u)
slack_thread:
part2_followon: DONE — 공단부담액(명세) 정보성 라인 표시 + 저장처 확정(service_charges.insurance_covered_amount 재사용). Part1과 통합 배포.
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

---

## Part2 (완료 — DA CONSULT-REPLY MSG-20260714-121317-pq2t GO / db_change=false / DDL 없음)

**공단부담액(명세) 별도 정보성 라인 표시 + 저장처 확정.** 수납잔액(payments grain)에는 미포함 —
환자가 내지 않는 공단(NHIS) 몫을 스태프가 시각적으로 구분해 확인하는 정보성 표시.

### 저장처 확정 (신규 저장처 불요 · DDL 없음)
- **공단부담금 저장처 = 기존 canonical 컬럼 `service_charges.insurance_covered_amount` 재사용.**
  - `copayment_amount` = 급여 본인부담금(환자 몫) → 수납잔액 포함.
  - `insurance_covered_amount` = 공단부담액(NHIS 몫) → 수납잔액 제외 = 공단부담금 저장처.
- 기록 경로: `InsuranceCopaymentPanel.persistCharges`(append-only 감사) L162 — 이미 존재. 신규 write 0.
- 신규 컬럼/테이블/enum 0 → 대표·MIG·supervisor DDL-diff 게이트 전부 면제(DA §3.1).

### 구현 (src/components/PaymentMiniWindow.tsx) — 병렬 계산 경로 신설 금지(DA §제약1) 준수
1. `insuranceCoveredTotal = footBilling.liveBillingValues.insuranceCovered` 신규 파생 —
   배포 SSOT `computeFootBilling`(footBilling.ts) 소비만. inline 재구현 0.
2. 세금구분/급여 자부담 라인 아래에 **"공단부담액(명세)"** 정보성 라인 추가(muted 스타일, 값>0일 때만).
   - 라벨 = **"공단부담액(명세)"** (SSOT §3-L280). ❌"공단청구액(EDI)" 금지 — 명세 기준 추정액(공단 심사 전).
3. 수납잔액(볼드 합계)·수납 amount 는 Part1 그대로 — 공단부담액은 배타(수납 대상 아님).

### 엣지(시나리오3, grade=null / DA §제약3)
- footBilling 이 DOCPRINT-RECUR 규칙으로 **본인=급여전액 / 공단=0** 산출 → **소비값 그대로**(0/price 날조 없음).
  공단부담액=0 → 라인 자동 숨김(값>0 조건).
- general 외 등급의 hira NULL BLOCK 은 `calc_copayment` v1.3(has_nullblock=T)이 service_charges **기록 단계**에서
  `data_incomplete=true`(금액 NULL)로 차단 — PMW **라이브 표시**는 footBilling 소비값 유지(무접촉).

### cross-ref grain 정합 (DA §제약4, SSOT §5)
- **수납잔액**(payments grain) = 본인부담금 + 비급여 = `computeFootBilling`.copaymentTotal + nonCoveredTotal.
- **공단부담액**(명세 grain) = `computeFootBilling`.liveBillingValues.insuranceCovered.
- **발행문서**(bill_detail / DocumentPrintPanel) = `buildFootBillDetailItems`/`fillBillItemCopayment`(동일 footBilling SSOT).
- **매출집계 SalesDoctor** = `service_charges.insurance_covered_amount` SUM(명세 grain) + payments(수납 grain 본인부담금)
  — 라벨 "공단부담액(명세)" 동일. → 4경로 모두 동일 SSOT/grain 일관(불변식: 수납잔액 + 공단부담액 = 총 진료비).

### QA (dev self)
- E2E: **10/10 PASS** (Part1 6 + Part2 4 — 공단부담액=급여−본인부담금 / 배타 불변식 / grade=null 라인숨김 / 저장처 정합).
- 회귀: 빌링 표면 62/62 PASS (DOCPRINT-INSURANCE-SPLIT-RECUR / COPAY-MINI-BUG / RECEIPT-ITEMIZED / PMW-SPLIT-PAYMENT / DOCFORM-3FIX).
- build: pass. db_change: false.

### 배포
- Part1(read-side 수납잔액) + Part2(공단부담액 라인·저장처 확정) **통합 배포**. hotfix 경로 → supervisor QA(E2E 시나리오1·2·3).
