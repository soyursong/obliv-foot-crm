---
id: T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT
domain: foot
priority: P0
hotfix: true
status: deploy-ready
qa_result: pass
deploy_commit: Part1 e14557269b23 + Part2 통합 + REOPEN#5 ac31d406 (fix) / d20e061e (render spec+evidence)
deployed_at: pushed to main 2026-07-15 (Cloudflare Pages 자동배포 — pages.dev 라이브 확인됨, supervisor fresh-session QA 대기)
bundle_hash: 로컬 build PaymentMiniWindow-CmwUlmho.js / 배포 pages.dev PaymentMiniWindow-DUwt_va4.js (신규 라벨 template-literal 포함 확인)
db_change: false
db_migration: none
db_gate: N/A — DA CONSULT-REPLY(MSG-20260714-121317-pq2t) GO / db_change=false / 신규 컬럼·테이블·enum 0. 공단부담금 저장처 = 기존 canonical 컬럼 service_charges.insurance_covered_amount 재사용(DDL 없음). 대표·MIG·supervisor DDL-diff 게이트 전부 면제(§3.1).
build: pass (npm run build ✓)
ui_screenshot_gate: satisfied — evidence/T-20260714-PAYMINI-COPAY-TAXLINE-taxbox.png (실 DOM 렌더: "급여 자부담(30%) 9,700" + "공단부담액(명세) 22,510")
scenario_count: 3 (Part1) + 4 (Part2) + 5 (REOPEN#5) + 1 render = 24 assertions
reopen5: DONE — 세금구분 '급여' 라인 = 급여 자부담(30%) relabel + SSOT payCopaymentTotal 배선(공단 제외). 중복 blue 라인 제거. 실브라우저 렌더+스크린샷 evidence.
e2e_spec: tests/e2e/T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT.spec.ts + tests/e2e/T-20260714-foot-PAYMINI-COPAY-TAXLINE-RENDER.spec.ts
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

---

## REOPEN#5 (2026-07-15, 김주연 총괄 스크린샷+직접요구 / FIX-REQUEST MSG-20260715-101005-eq21)

REOPEN#4 disambiguation 해소: 총괄이 보는 곳은 '수납잔액 총액'이 아니라 결제미니창 **'세금 구분' 내역의 '급여' 라인**.
그 라인이 공단부담 포함 전체 급여액(coveredTotal)을 "급여"로 표시 → 환자 자부담(30%)만 "급여 자부담(30%)"로.

### 3가지 변경 (로직 재수정 아님 — 세금구분 라인 SSOT 배선+relabel)
1. **금액**: totalByTax 맵 cls==='급여' 행 금액 = `payCopaymentTotal`(배포 SSOT `computeFootBilling`,
   general_default 30%, v1.11 §2-2-4) 소비. coveredTotal(본인+공단) 제외. 인라인 병렬 재계산 없음(DA §제약1).
2. **라벨**: "급여" → "급여 자부담(30%)" (copayRate 기반 `급여 자부담(${%})`).
3. **공단부담(70%)**: 기존 '공단부담액(명세)' 라인 유지 = `service_charges.insurance_covered_amount` 재사용
   (신규 저장처/DDL 없음). + 중복이 되는 별도 blue '급여 자부담' 라인 제거(세금구분 급여 라인으로 흡수).

### 구현 (src/components/PaymentMiniWindow.tsx L2471~)
- `totalByTax` 맵에서 `cls==='급여'` 행: label=`급여 자부담(30%)`, amount=`payCopaymentTotal`. 그 외 클래스 불변.
- 하단 별도 `text-blue-700` '급여 자부담' 블록 삭제(중복 표시 방지).

### 검증 (anti-fingerprint — content-fingerprint 5회 반증 대체)
- **실브라우저 DOM 렌더**(로컬 dev = 배포 동일 소스, 同 prod DB): 급여환자 payment_waiting 시드 →
  대시보드 [결제하기] 실클릭 → PMW 모달 세금구분 급여 라인 DOM 직접 단언 + 스크린샷 evidence.
  → 화면 실측: **"급여 자부담(30%) 9,700"** (전체 급여액 32,210 아님) / **"공단부담액(명세) 22,510"** /
     불변식 자부담+공단부담액=전체 급여액. (evidence/T-20260714-PAYMINI-COPAY-TAXLINE-taxbox.png)
- **배포 pages.dev 확인**: 배포 chunk PaymentMiniWindow-DUwt_va4.js 에 신규 라벨 template-literal(`급여 자부담${...}`) 포함.
- **E2E**: PAYMINI-COPAY-BALANCE-SPLIT 23/23 PASS (기존 18 + REOPEN#5 5) + TAXLINE-RENDER 2/2 PASS.
- **회귀**: COPAY-MINI-BUG / DOCPRINT-INSURANCE-SPLIT-RECUR / RECEIPT-ITEMIZED / PMW-SPLIT-PAYMENT 51/51 PASS.

### ball → supervisor
dev GO(fix+렌더 실측 GO 완료) → **supervisor 실브라우저 QA(pages.dev fresh session, 구탭 금지)** →
responder 총괄 confirm → planner done. **현장 확인 前 '완료' 통보 금지.**
