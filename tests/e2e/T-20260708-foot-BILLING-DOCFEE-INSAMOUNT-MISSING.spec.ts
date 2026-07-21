/**
 * E2E Spec — T-20260708-foot-BILLING-DOCFEE-INSAMOUNT-MISSING (P0)
 *
 * 진료비 계산서·영수증(bill_receipt) + 진료비 세부산정내역(bill_detail)에서 공단부담/본인부담
 * 금액이 미출력(공란/하드코딩 0)되어 청구서류 제출이 불가하던 P0 블로커(김나영 센터장 ESCALATE,
 * body T-20260706-CHART-BILLING-AUTOMAP-HOLIDAY AC-2/AC-3 미러) 해소를 단위 검증.
 *
 * 재현/근본원인(코드 실측, DB 무변):
 *   BUG-1 (bill_receipt): 소계 '본인부담' 셀이 하드코딩 공란 → copayment 값이 3경로 모두 산출·bind
 *     되나 template placeholder({{copayment}}) 누락으로 영원히 미출력. (공단부담={{insurance_covered}}
 *     는 이미 배선.)
 *   BUG-2 (bill_detail): 계/합계 요약행의 본인부담금·공단부담금 열이 하드코딩 '0' → per-item 행은
 *     정상이나 요약 총계가 0 고정.
 *   ⇒ 둘 다 값은 존재·템플릿 하드코딩이 근인 = "데이터 존재·렌더 바인딩 누락" 패턴.
 *
 * 수정:
 *   AC-2(receipt): 소계 본인부담 = {{copayment}} 바인딩. 공단부담=건보부담, 본인부담=본인부담합계,
 *                  합계 = 건보부담 + 본인부담합계 + 비급여 검산.
 *   AC-3(detail): 계/합계 본인부담금={{*_copayment}}, 공단부담금={{*_fund}} 바인딩 + DocumentPrintPanel
 *                 3경로(재발급/배치/단건) 총계 주입. per-item 컬럼합과 정합.
 *
 * 본 spec 은 산출 SSOT(computeFootBilling → buildFootBillDetailItems → buildBillDetailItemsHtml)와
 * 양식 바인딩(getHtmlTemplate + bindHtmlTemplate)을 실데이터 형상으로 직접 단언(실서버 불필요).
 *
 * 실행: npx playwright test T-20260708-foot-BILLING-DOCFEE-INSAMOUNT-MISSING.spec.ts
 */

import { test, expect } from '@playwright/test';
import {
  computeFootBilling,
  buildFootBillDetailItems,
  type FootBillingItem,
  type BillingService,
} from '../../src/lib/footBilling';
import {
  buildBillDetailItemsHtml,
  getHtmlTemplate,
  bindHtmlTemplate,
} from '../../src/lib/htmlFormTemplates';
import { formatAmount } from '../../src/lib/format';

const svc = (over: Partial<BillingService> & { id: string; name: string }): BillingService => ({
  service_code: null, hira_code: null, vat_type: 'none',
  is_insurance_covered: false, category_label: null, price: 0, ...over,
});

// 정상 케이스: 재진진찰료(AA254, 13,370, 급여) + 레이저(SZ035, 350,000, 비급여), grade=general(30%).
const CASE_NORMAL: FootBillingItem[] = [
  { service: svc({ id: 'c1', name: '재진진찰료-의원', service_code: 'AA254', is_insurance_covered: true, category_label: '기본', price: 13370 }), qty: 1, unitPrice: 13370 },
  { service: svc({ id: 's1', name: '가열성 진균증 레이저 치료', service_code: 'SZ035', is_insurance_covered: false, category_label: '풋케어', price: 350000 }), qty: 1, unitPrice: 350000 },
];

test.describe('T-20260708 진료비 서류 공단/본인부담 금액 출력 (bill_receipt + bill_detail)', () => {
  test('산출 SSOT: 급여/본인부담/공단부담/비급여/합계 기준값', () => {
    const fb = computeFootBilling(CASE_NORMAL, 'general');
    expect(fb.grandTotal).toBe(363370);          // 합계
    expect(fb.coveredTotal).toBe(13370);          // 급여총액
    expect(fb.copaymentTotal).toBe(4000);         // 본인부담금(30% 100원 절사: FLOOR(4011/100)*100=4000. T-20260715 CEIL→FLOOR canon 정정, 구 CEIL 4100 stale)
    expect(fb.nonCoveredTotal).toBe(350000);      // 비급여
    // 공단부담(건보부담) = 급여총액 - 본인부담
    expect(fb.liveBillingValues.insuranceCovered).toBe(9370);  // 13,370 - 4,000 (구 9,270 = CEIL 4100 잔재)
    expect(fb.liveBillingValues.copayment).toBe(4000);
    // 검산: 건보부담 + 본인부담 + 비급여 = 합계 (AC-2)
    expect(
      fb.liveBillingValues.insuranceCovered + fb.liveBillingValues.copayment + fb.nonCoveredTotal,
    ).toBe(fb.grandTotal);
  });

  test('AC-2 (bill_receipt): 소계 공단부담 + 본인부담 금액이 모두 출력된다 (본인부담 공란 아님)', () => {
    const fb = computeFootBilling(CASE_NORMAL, 'general');
    const tpl = getHtmlTemplate('bill_receipt');
    expect(tpl, 'bill_receipt 양식 존재').toBeTruthy();

    // DocumentPrintPanel 3경로가 bind 하는 값과 동일 형태 주입.
    const bound = bindHtmlTemplate(tpl!, {
      patient_name: '홍길동',
      insurance_covered: formatAmount(fb.liveBillingValues.insuranceCovered), // 9,370
      copayment: formatAmount(fb.liveBillingValues.copayment),                // 4,000
      non_covered: formatAmount(fb.nonCoveredTotal),                          // 350,000
      // GONGDAN-HIDE canon(T-20260714-foot-DOCPRINT-GONGDAN-HIDE-COPAY-ONLY B안): bill_receipt 합계는
      //   receipt_total = 급여 본인부담금 + 비급여(공단부담 제외) 로 바인딩. 구 total_amount(공단포함 grandTotal)
      //   placeholder 는 제거됨(htmlFormTemplates L1780) → 구 기대값 363,370 은 stale.
      receipt_total: formatAmount(fb.liveBillingValues.copayment + fb.nonCoveredTotal), // 354,000 = 4,000 + 350,000
    });

    // 회귀 가드: 미치환 placeholder 잔존 금지
    expect(bound).not.toContain('{{copayment}}');
    expect(bound).not.toContain('{{insurance_covered}}');
    expect(bound).not.toContain('{{receipt_total}}');

    // 공단부담(9,370) + 본인부담(4,000) 둘 다 렌더
    expect(bound).toContain('9,370');
    expect(bound, '본인부담(4,000)이 영수증에 출력되어야 함 = BUG-1 해소').toContain('4,000');
    expect(bound).toContain('350,000');
    // 합계 = receipt_total 354,000 (공단 제외, GONGDAN-HIDE). 구 grandTotal 363,370 = stale(공단포함).
    expect(bound, '환자 청구 합계 = 본인부담 + 비급여(공단 제외) = 354,000').toContain('354,000');
  });

  test('AC-3 (bill_detail): 계/합계 요약행 본인부담금·공단부담금 총계가 하드코딩 0이 아니다', () => {
    const fb = computeFootBilling(CASE_NORMAL, 'general');
    const billItems = buildFootBillDetailItems(fb.pricingItems, '2026-07-08', {
      insuranceGrade: 'general',
      copaymentTotal: fb.copaymentTotal,
    });
    const itemsHtml = buildBillDetailItemsHtml(billItems);

    const tpl = getHtmlTemplate('bill_detail');
    expect(tpl, 'bill_detail 양식 존재').toBeTruthy();

    // DocumentPrintPanel 이 요약행에 주입하는 총계값(수정으로 신설한 변수).
    const bound = bindHtmlTemplate(tpl!, {
      items_html: itemsHtml,
      subtotal_amount: formatAmount(fb.grandTotal),
      total_amount: formatAmount(fb.grandTotal),
      subtotal_noncovered: fb.nonCoveredTotal.toLocaleString('ko-KR'),
      total_noncovered: fb.nonCoveredTotal.toLocaleString('ko-KR'),
      subtotal_copayment: formatAmount(fb.copaymentTotal),                    // 4,000
      total_copayment: formatAmount(fb.copaymentTotal),
      subtotal_fund: formatAmount(fb.liveBillingValues.insuranceCovered),     // 9,370
      total_fund: formatAmount(fb.liveBillingValues.insuranceCovered),
    });

    // 회귀 가드: 요약행 총계 placeholder 미치환 금지
    expect(bound).not.toContain('{{total_copayment}}');
    expect(bound).not.toContain('{{total_fund}}');
    expect(bound).not.toContain('{{subtotal_copayment}}');
    expect(bound).not.toContain('{{subtotal_fund}}');

    // 요약행 본인부담금(4,000)/공단부담금(9,370) 총계가 출력됨 (BUG-2 해소)
    expect(bound, '요약행 본인부담금 총계 출력').toContain('4,000');
    expect(bound, '요약행 공단부담금 총계 출력').toContain('9,370');

    // per-item 컬럼합 정합: Σ본인부담금 = copaymentTotal, Σ공단부담금 = insuranceCovered
    const covered = billItems.filter((i) => i.is_insurance_covered);
    const sumCopay = covered.reduce((s, i) => s + (i.copayment_amount ?? 0), 0);
    const sumFund = covered.reduce(
      (s, i) => s + Math.max(0, i.amount * (i.count ?? 1) * (i.days ?? 1) - (i.copayment_amount ?? 0)),
      0,
    );
    expect(sumCopay).toBe(fb.copaymentTotal);                     // 4,000
    expect(sumFund).toBe(fb.liveBillingValues.insuranceCovered);  // 9,370
  });

  test('AC-3 초진 코드 AA154 / 재진 코드 AA254 표기 (per-item 코드 배선)', () => {
    const firstVisit: FootBillingItem[] = [
      { service: svc({ id: 'c0', name: '초진진찰료-의원', service_code: 'AA154', is_insurance_covered: true, category_label: '기본', price: 17610 }), qty: 1, unitPrice: 17610 },
    ];
    const fb = computeFootBilling(firstVisit, 'general');
    const items = buildFootBillDetailItems(fb.pricingItems, '2026-07-08', {
      insuranceGrade: 'general', copaymentTotal: fb.copaymentTotal,
    });
    expect(items.find((i) => i.code === 'AA154'), '초진 AA154 행').toBeTruthy();

    const reItems = buildFootBillDetailItems(
      computeFootBilling(CASE_NORMAL, 'general').pricingItems, '2026-07-08',
      { insuranceGrade: 'general', copaymentTotal: 4000 },
    );
    expect(reItems.find((i) => i.code === 'AA254'), '재진 AA254 행').toBeTruthy();
  });

  test('엣지: 전액 비급여(급여 0) → 본인/공단 총계 0, 합계=비급여, 회귀 없음', () => {
    const allNonCovered: FootBillingItem[] = [
      { service: svc({ id: 's1', name: '레이저', service_code: 'SZ035', is_insurance_covered: false, category_label: '풋케어', price: 350000 }), qty: 1, unitPrice: 350000 },
    ];
    const fb = computeFootBilling(allNonCovered, 'general');
    expect(fb.copaymentTotal).toBe(0);
    expect(fb.liveBillingValues.insuranceCovered).toBe(0);
    expect(fb.grandTotal).toBe(350000);
    // 요약행은 '0' 명시(공란 아님) — DocumentPrintPanel empty/비급여 경로가 formatAmount(0)='0' 주입.
    expect(formatAmount(fb.copaymentTotal)).toBe('0');
    expect(formatAmount(fb.liveBillingValues.insuranceCovered)).toBe('0');
  });
});
