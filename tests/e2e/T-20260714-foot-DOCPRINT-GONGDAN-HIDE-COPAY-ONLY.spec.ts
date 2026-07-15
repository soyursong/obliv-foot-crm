/**
 * T-20260714-foot-DOCPRINT-GONGDAN-HIDE-COPAY-ONLY (B안) — 진료비 서류 '합계'에서 공단부담금 제외
 *
 * 확정 스펙(B안, 김주연 총괄 ts 1784020522.027429):
 *   - 공단부담금 칸/금액 **표시는 그대로 유지**(split 표시 배포본·의료법 법정서식 보존).
 *   - 환자에게 받는 **'합계 금액'에서만 공단부담금 제외** → 합계 = 급여 본인부담금 + 비급여.
 *   - 대상 서류: ① 진료비 계산서·영수증(bill_receipt) ② 진료비 세부산정내역(bill_detail).
 *   - 현재 결제창 수납잔액 방식(PAYMINI-COPAY-BALANCE-SPLIT)과 동일 산식.
 *
 * 본 harness 는 **앱과 동일한 SSOT 함수**(computeFootBilling / buildFootBillDetailItems /
 *   buildBillDetailItemsHtml / buildBillReceiptFeeGridHtml)로 문서 HTML 을 산출하고, DocumentPrintPanel
 *   과 동일하게 detail_total/detail_subtotal/receipt_total(= copaymentTotal + nonCoveredTotal)을 바인딩해
 *   실제 Chromium 에 page.setContent + emulateMedia({media:'print'}) 로 인쇄 미리보기를 캡처한다(AC-5).
 *
 * AC:
 *   AC-1: 계산서·영수증 합계 = 본인부담금 + 비급여 (공단 제외)
 *   AC-2: 세부산정내역 합계 = 본인부담금 + 비급여 (공단 제외)
 *   AC-3: 공단부담금 별도 라인/칸 표기 유지 — 합계에서만 빠짐
 *   AC-4: 비급여 출력·금액 회귀 0
 *   AC-5: 실브라우저 인쇄 미리보기 스크린샷 육안 대조 evidence
 *
 * 실행: npx playwright test --project=unit T-20260714-foot-DOCPRINT-GONGDAN-HIDE-COPAY-ONLY
 */

import { test, expect } from '@playwright/test';
import { homedir } from 'os';
import path from 'path';
import {
  computeFootBilling,
  buildFootBillDetailItems,
  type FootBillingItem,
  type BillingService,
} from '../../src/lib/footBilling';
import {
  getHtmlTemplate,
  bindHtmlTemplate,
  buildBillDetailItemsHtml,
  buildBillReceiptFeeGridHtml,
} from '../../src/lib/htmlFormTemplates';

const OUT_DIR = path.join(
  homedir(),
  'claude-sync/memory/_handoff/qa_screenshots/T-20260714-foot-DOCPRINT-GONGDAN-HIDE-COPAY-ONLY',
);

const svc = (over: Partial<BillingService> & { id: string; name: string }): BillingService => ({
  service_code: null, hira_code: null, vat_type: 'none',
  is_insurance_covered: false, category_label: null, price: 0, ...over,
});

// 급여(재진진찰료 AA254 13,370, covered=true) + 비급여(레이저 350,000) 혼합 방문.
const MIXED_VISIT: FootBillingItem[] = [
  { service: svc({ id: 'c1', name: '재진진찰료-의원', service_code: 'AA254', hira_code: 'AA254', is_insurance_covered: true, category_label: '기본', price: 13370 }), qty: 1, unitPrice: 13370 },
  { service: svc({ id: 's1', name: '가열성 진균증 레이저 치료', service_code: 'SZ035', is_insurance_covered: false, category_label: '풋케어', price: 350000 }), qty: 1, unitPrice: 350000 },
];

const won = (n: number) => n.toLocaleString('ko-KR');

/** 세부산정내역(bill_detail) 문서 HTML — DocumentPrintPanel 바인딩과 동일 필드 소스(B안). */
function renderBillDetailDoc(grade: 'general' | null): string {
  const fb = computeFootBilling(MIXED_VISIT, grade);
  const items = buildFootBillDetailItems(fb.pricingItems, '2026-07-14', {
    insuranceGrade: grade,
    copaymentTotal: fb.copaymentTotal,
  });
  const itemsHtml = buildBillDetailItemsHtml(items);
  const tpl = getHtmlTemplate('bill_detail')!;
  const lv = fb.liveBillingValues;
  // B안: 합계 = 본인부담금 + 비급여 (공단 제외). 공단부담금(subtotal_fund/total_fund) 표시는 유지.
  const excludeCopay = won(fb.copaymentTotal + fb.nonCoveredTotal);
  return bindHtmlTemplate(tpl, {
    clinic_code: '11111111', clinic_name: '오블리브 풋의원',
    doctor_name: '문지은', doctor_seal_html: '',
    issue_date: '2026-07-14', visit_date: '2026-07-14',
    patient_name: '홍길동', patient_rrn: '900101-1******', record_no: 'F-4621',
    items_html: itemsHtml,
    detail_subtotal: excludeCopay, detail_total: excludeCopay,
    subtotal_copayment: won(fb.copaymentTotal), subtotal_fund: won(lv.insuranceCovered),
    subtotal_noncovered: won(fb.nonCoveredTotal),
    total_copayment: won(fb.copaymentTotal), total_fund: won(lv.insuranceCovered),
    total_noncovered: won(fb.nonCoveredTotal),
    // total_amount 은 대상 2종의 합계 셀에서 미사용(다른 양식 전용). 회귀 확인용으로만 전달.
    subtotal_amount: won(fb.grandTotal), total_amount: won(fb.grandTotal),
  });
}

/** 계산서·영수증(bill_receipt) 문서 HTML — 동일 SSOT 소스(B안). */
function renderBillReceiptDoc(grade: 'general' | null): string {
  const fb = computeFootBilling(MIXED_VISIT, grade);
  const items = buildFootBillDetailItems(fb.pricingItems, '2026-07-14', {
    insuranceGrade: grade,
    copaymentTotal: fb.copaymentTotal,
  });
  const feeGridHtml = buildBillReceiptFeeGridHtml(items);
  const tpl = getHtmlTemplate('bill_receipt')!;
  const lv = fb.liveBillingValues;
  const receiptTotal = won(fb.copaymentTotal + fb.nonCoveredTotal);
  return bindHtmlTemplate(tpl, {
    clinic_name: '오블리브 풋의원', clinic_address: '서울시 종로구', clinic_phone: '02-000-0000',
    doctor_name: '문지은', doctor_seal_html: '',
    patient_name: '홍길동', patient_rrn: '900101-1******', birth_date: '1990-01-01',
    patient_address: '서울시', patient_phone: '010-0000-0000',
    chart_number: 'F-4621', issue_date: '2026-07-14', visit_date: '2026-07-14',
    collected_date: '2026-07-14', requested_date: '2026-07-14',
    insurance_grade_label: grade === 'general' ? '건강보험(일반)' : '미등록',
    copay_rate: grade === 'general' ? '30' : '-',
    fee_grid_html: feeGridHtml,
    insurance_covered: won(lv.insuranceCovered),
    copayment: won(fb.copaymentTotal),
    non_covered: won(fb.nonCoveredTotal),
    receipt_total: receiptTotal,
    total_amount: won(fb.grandTotal),
    remark: '', request_no: '', specimen_no: '', specimen_type: '',
    special_treatment_code: '', diag_code_1: '', diag_name_1: '',
    diag_code_2: '', diag_name_2: '', diag_code_3: '', diag_name_3: '',
    diag_code_4: '', diag_name_4: '', diag_row_3_style: 'display:none',
    diag_row_4_style: 'display:none',
  });
}

async function snap(page: import('@playwright/test').Page, html: string, file: string) {
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.emulateMedia({ media: 'print' });
  await page.screenshot({ path: path.join(OUT_DIR, file), fullPage: true });
}

test.describe('T-20260714-DOCPRINT-GONGDAN-HIDE-COPAY-ONLY (B안) — 합계 공단 제외·공단 표시 유지', () => {
  test.use({ viewport: { width: 1123, height: 900 } }); // A4 landscape @96dpi

  // 기대값 (general grade): 본인 4,100 / 공단 9,270 / 비급여 350,000 / grandTotal 363,370 / 합계 354,100
  test('pure-path: 합계 산식 = 본인부담금 + 비급여 (공단 제외), 공단 값은 별도 산출', () => {
    const fb = computeFootBilling(MIXED_VISIT, 'general');
    expect(fb.copaymentTotal).toBe(4100);                      // 본인부담금
    expect(fb.liveBillingValues.insuranceCovered).toBe(9270);  // 공단부담금
    expect(fb.nonCoveredTotal).toBe(350000);                   // 비급여
    expect(fb.grandTotal).toBe(363370);                        // 급여전액+비급여(공단 포함)
    // B안 합계 = 본인부담금 + 비급여 = 354,100 (공단 9,270 제외 → grandTotal 보다 정확히 공단만큼 작음)
    const billTotal = fb.copaymentTotal + fb.nonCoveredTotal;
    expect(billTotal).toBe(354100);
    expect(fb.grandTotal - billTotal).toBe(fb.liveBillingValues.insuranceCovered);
  });

  test('fee_grid(계산서·영수증): 공단부담 열 유지(4셀) + 행 합계 = 본인부담 + 비급여(공단 제외)', () => {
    const fb = computeFootBilling(MIXED_VISIT, 'general');
    const items = buildFootBillDetailItems(fb.pricingItems, '2026-07-14', {
      insuranceGrade: 'general', copaymentTotal: fb.copaymentTotal,
    });
    const grid = buildBillReceiptFeeGridHtml(items);
    // AC-3: 공단부담(9,270)·본인부담(4,100) 모두 표기 유지
    expect(grid).toContain('9,270');
    expect(grid).toContain('4,100');
    // 급여 행 합계 = 본인부담(4,100) + 비급여 0(이 행은 급여) → 4,100. 공단 포함(13,370) 아님.
    // 4셀 구조 유지: <td class="br-num"> 가 급여 행에 4개(공단|본인|비급여|합계).
    const coveredRow = grid.split('\n').find((r) => r.includes('9,270'))!;
    expect((coveredRow.match(/br-num/g) || []).length).toBe(4);
    expect(coveredRow).not.toContain('13,370'); // 급여 행 합계에 공단포함 전액 미표기
  });

  test('S1 세부산정내역 grade 실재(general) → 공단 9,270 표기 유지 + 합계 354,100(공단 제외)', async ({ page }) => {
    const html = renderBillDetailDoc('general');
    expect(html).toContain('9,270');    // AC-3 공단부담금 표시 유지
    expect(html).toContain('4,100');    // 본인부담금
    expect(html).toContain('350,000');  // AC-4 비급여 회귀 0
    expect(html).toContain('354,100');  // AC-2 합계 = 본인 + 비급여(공단 제외)
    expect(html).not.toContain('363,370'); // 공단포함 grandTotal 이 합계로 노출되지 않음
    await snap(page, html, 'S1-detail-graded.png');
  });

  test('S2 계산서·영수증 grade 실재(general) → 공단 9,270 표기 유지 + 합계 354,100(공단 제외)', async ({ page }) => {
    const html = renderBillReceiptDoc('general');
    expect(html).toContain('9,270');    // AC-3 공단부담 열 표시 유지
    expect(html).toContain('4,100');    // 본인부담
    expect(html).toContain('350,000');  // AC-4 비급여 회귀 0
    expect(html).toContain('354,100');  // AC-1 합계 = 본인 + 비급여(공단 제외)
    expect(html).not.toContain('363,370'); // 공단포함 총액이 합계로 노출되지 않음
    await snap(page, html, 'S2-receipt-graded.png');
  });

  test('S3 세부산정내역 grade-null → 공단 0 표기 유지 + 합계 363,370(본인전액+비급여)', async ({ page }) => {
    // 등급 미상 → 본인=급여전액(13,370)/공단=0(covered_full 폴백). 합계=13,370+350,000=363,370.
    const html = renderBillDetailDoc(null);
    expect(html).toContain('13,370');   // 본인부담금 = 급여전액
    expect(html).toContain('350,000');  // 비급여
    expect(html).toContain('363,370');  // 합계 = 본인전액 + 비급여 (공단=0 이라 grandTotal 과 동일)
    await snap(page, html, 'S3-detail-gradenull.png');
  });

  test('S4 계산서·영수증 grade-null → 공단 0 표기 유지 + 합계 363,370(본인전액+비급여)', async ({ page }) => {
    const html = renderBillReceiptDoc(null);
    expect(html).toContain('13,370');
    expect(html).toContain('350,000');
    expect(html).toContain('363,370');
    await snap(page, html, 'S4-receipt-gradenull.png');
  });
});
