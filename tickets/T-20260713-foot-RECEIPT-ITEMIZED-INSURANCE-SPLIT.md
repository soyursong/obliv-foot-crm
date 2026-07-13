---
id: T-20260713-foot-RECEIPT-ITEMIZED-INSURANCE-SPLIT
domain: foot
status: deploy-ready
priority: P1
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260713-foot-RECEIPT-ITEMIZED-INSURANCE-SPLIT.spec.ts
qa_result: pass
created: 2026-07-13
deadline: 2026-07-13
---

# T-20260713-foot-RECEIPT-ITEMIZED-INSURANCE-SPLIT — 진료비 계산서·영수증 출력 3축 미배선 (P1)

보고(김주연 총괄, thread 1783425100.038879). 계산서·영수증 문서에서:
- (a) 항목별 구분 없음 (진료비/치료비/검사비 등 카테고리 분리 필요)
- (b) 공단부담/본인부담 구분 없음
- (c) 전체가 비급여로 묶여 출력 (급여 항목도 비급여로 찍힘)

## diagnose-first RC

1. **렌더 함수 특정**: 계산서·영수증(form_key='bill_receipt')은 `BILL_RECEIPT_HTML` 정적 템플릿을
   `bindHtmlTemplate` 으로 렌더. 세부산정내역(bill_detail)과는 **별도 템플릿**이나, 산출 소스는
   동일 SSOT(`computeFootBilling` + `buildFootBillDetailItems`)를 이미 각 경로에서 산출 중이었다.
2. **구조 RC (a)(c)**: `BILL_RECEIPT_HTML` tbody 가 **정적 하드코딩 그리드**였다 — 12개 표준 행이
   모두 빈칸이고 '처치 및 수술료' 한 행의 비급여 열에 `{{non_covered}}`, 합계 열에 `{{total_amount}}`
   만 직결. 즉 전 금액이 한 행 비급여로 뭉뚱그려지고 항목 카테고리·급여/비급여가 미분리.
   렌더 경로가 이미 SSOT billItems 를 산출하나 템플릿이 per-item 을 소비하지 못하는 구조가 근인.
3. **(b) 공단/본인**: per-category 로 채워지지 않고 소계행({{insurance_covered}}/{{copayment}})
   집계만 표기됐다. grade=null 방문은 copaymentTotal=0 → 공단=전액/본인=0 (세부산정내역과 동일 정상).
4. **db_change 판정**: 신규 컬럼·테이블·enum **불요**. 기존 SSOT 산출을 렌더에 배선만 하는 순수 FE 변경.
   MIG-GATE / data-architect CONSULT 불요.

## 해소

세부산정내역과 **동일 SSOT**(`buildFootBillDetailItems` 출력)를 HIRA 항목분류
(`footBillDetailCategory`)로 집계하는 `buildBillReceiptFeeGridHtml` 신설 → 템플릿 정적 그리드를
`{{fee_grid_html}}` 로 교체. 병렬 신규 산출로직·프린트경로 신설 0 (divergence 방지).

- 급여 행: 공단부담 = 항목총액 − copayment_amount, 본인부담 = copayment_amount
- 비급여 행: 비급여 열
- Σ(행 공단/비급여/합계) = 소계행 {{insurance_covered}}/{{non_covered}}/{{total_amount}} 구조 정합

배선 경로(모두 동일 SSOT):
- `DocumentPrintPanel.tsx` — 재발급(PATH), 배치 출력, IssueDialog 단건 (3경로)
- `PaymentMiniWindow.tsx` — 결제창 단독발행 + 출력·수납 (PATH-4)
- 폴백(check_in_services 미기록 구 데이터) = service_charges 직결 + fillBillItemCopayment (bill_detail 폴백 규칙과 동일)
- 항목 0건 → `buildBillReceiptFeeGridHtml([])` 표준 빈 그리드(본문 공란 회귀 방지)

## AC 검증 (E2E 실브라우저 8/8 PASS)

- AC-1 항목 카테고리 구분: 진찰료 18,840 / 검사료 60,540 / 처치 및 수술료 300,000 각 행 배치 ✓
- AC-2/6 공단/본인 분리 (grade=null → 공단=전액/본인=0, 세부산정내역과 동일) ✓
- AC-3 급여/비급여 정확 분류 (검사료 비급여 50,000·처치 300,000 각 행 분리, 급여 행 비급여 공란) ✓
- AC-4 소계 정합 (공단 29,380 / 비급여 350,000 / 합계 379,380) ✓
- AC-5 실브라우저 렌더 (page.setContent) + 미치환 placeholder 0 ✓
- 회귀가드: 항목 0건 표준 빈 그리드 + 구조가드(정적 하드코딩 제거) ✓

## 회귀

세부산정내역 착지분(BILLDETAIL-CATEGORY-HARDCODE / DOCPRINT-INSURANCE-SPLIT-RECUR /
FEEBREAKDOWN-INSURANCE-BLANK / BILLING-DOCFEE-INSAMOUNT-MISSING) 관련 스펙 170 PASS 무회귀.
(별건 2 fail = T-20260521-DOC-PRINT-UNIFY JPG isHtmlTemplate 사전존재 실패, 본 티켓 무관.)

## FOLLOWUP (범위밖, 직교축)

- 실 % 본인부담 split 은 접수시 `insurance_grade` 캡처 필요 = grade-capture 직교축. grade=null
  방문은 공단=전액/본인=0 정상(세부산정내역과 동일). — planner 기추적(INSURANCE-BLANK 라인).
- 별건: T-20260521-DOC-PRINT-UNIFY §2 JPG isHtmlTemplate 사전존재 2-fail (JPG→HTML 전환 미반영 stale) — 본 티켓 무관, 별도 티켓 필요.
