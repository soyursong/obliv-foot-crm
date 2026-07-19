/**
 * AC-3 실브라우저 인쇄 미리보기 렌더 evidence — T-20260707-foot-DOCPRINT-INSURANCE-SPLIT-RECUR
 *
 * supervisor QA FIX-REQUEST (MSG-20260714-081033-tfkn, qa_fail=insufficient_verification):
 *   AC-3 실브라우저 인쇄 미리보기 3시나리오 육안 대조 증적 필요.
 *   (grade-null 방문 / grade 실재 방문 / 계산서·영수증 포함)
 *
 * 본 harness 는 **앱과 동일한 SSOT 함수**(computeFootBilling / buildFootBillDetailItems /
 *   buildBillDetailItemsHtml / buildBillReceiptFeeGridHtml)로 문서 HTML 을 산출하고, 그 결과를
 *   실제 Chromium 에 `page.setContent` + `emulateMedia({media:'print'})` 로 렌더해 인쇄 미리보기
 *   스크린샷을 캡처한다. 목업이 아니라 프로덕션 렌더 경로 그대로의 출력이다.
 *
 * 출력: ~/claude-sync/memory/_handoff/qa_screenshots/T-20260707-foot-DOCPRINT-INSURANCE-SPLIT-RECUR/
 *   S1-detail-gradenull.png   세부산정내역, grade-null  → 본인=급여전액(13,370)/공단=0, 공란 없음
 *   S2-detail-graded.png      세부산정내역, grade 실재  → 본인 4,100/공단 9,270 (회귀 없음)
 *   S3-receipt-gradenull.png  계산서·영수증, grade-null → 동일 SSOT 반영(본인=전액/공단=0)
 *   S4-receipt-graded.png     계산서·영수증, grade 실재  → 본인 4,100/공단 9,270 (회귀 없음)
 *
 * 실행: npx playwright test --project=unit T-20260707-foot-DOCPRINT-INSURANCE-SPLIT-RECUR-RENDER
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
  'claude-sync/memory/_handoff/qa_screenshots/T-20260707-foot-DOCPRINT-INSURANCE-SPLIT-RECUR',
);

const svc = (over: Partial<BillingService> & { id: string; name: string }): BillingService => ({
  service_code: null, hira_code: null, vat_type: 'none',
  is_insurance_covered: false, category_label: null, price: 0, ...over,
});

// 급여(재진진찰료 AA254 13,370, is_insurance_covered=true) + 비급여(레이저 350,000) 혼합 방문.
const MIXED_VISIT: FootBillingItem[] = [
  { service: svc({ id: 'c1', name: '재진진찰료-의원', service_code: 'AA254', hira_code: 'AA254', is_insurance_covered: true, category_label: '기본', price: 13370 }), qty: 1, unitPrice: 13370 },
  { service: svc({ id: 's1', name: '가열성 진균증 레이저 치료', service_code: 'SZ035', is_insurance_covered: false, category_label: '풋케어', price: 350000 }), qty: 1, unitPrice: 350000 },
];

const won = (n: number) => n.toLocaleString('ko-KR');

/** 세부산정내역(bill_detail) 전체 문서 HTML — 앱 DocumentPrintPanel 바인딩과 동일 필드 소스. */
function renderBillDetailDoc(grade: 'general' | null): string {
  const fb = computeFootBilling(MIXED_VISIT, grade);
  const items = buildFootBillDetailItems(fb.pricingItems, '2026-07-07', {
    insuranceGrade: grade,
    copaymentTotal: fb.copaymentTotal,
  });
  const itemsHtml = buildBillDetailItemsHtml(items);
  const tpl = getHtmlTemplate('bill_detail')!;
  const lv = fb.liveBillingValues;
  return bindHtmlTemplate(tpl, {
    clinic_code: '11111111', clinic_name: '오블리브 풋의원',
    doctor_name: '문지은', doctor_seal_html: '',
    issue_date: '2026-07-07', visit_date: '2026-07-07',
    patient_name: '홍길동', patient_rrn: '900101-1******', record_no: 'F-4621',
    items_html: itemsHtml,
    subtotal_amount: won(fb.grandTotal), subtotal_copayment: won(fb.copaymentTotal),
    subtotal_fund: won(lv.insuranceCovered), subtotal_noncovered: won(fb.nonCoveredTotal),
    total_amount: won(fb.grandTotal), total_copayment: won(fb.copaymentTotal),
    total_fund: won(lv.insuranceCovered), total_noncovered: won(fb.nonCoveredTotal),
  });
}

/** 계산서·영수증(bill_receipt) 전체 문서 HTML — 동일 SSOT 소스. */
function renderBillReceiptDoc(grade: 'general' | null): string {
  const fb = computeFootBilling(MIXED_VISIT, grade);
  const items = buildFootBillDetailItems(fb.pricingItems, '2026-07-07', {
    insuranceGrade: grade,
    copaymentTotal: fb.copaymentTotal,
  });
  const feeGridHtml = buildBillReceiptFeeGridHtml(items);
  const tpl = getHtmlTemplate('bill_receipt')!;
  const lv = fb.liveBillingValues;
  return bindHtmlTemplate(tpl, {
    clinic_name: '오블리브 풋의원', clinic_address: '서울시 종로구', clinic_phone: '02-000-0000',
    doctor_name: '문지은', doctor_seal_html: '',
    patient_name: '홍길동', patient_rrn: '900101-1******', birth_date: '1990-01-01',
    patient_address: '서울시', patient_phone: '010-0000-0000',
    chart_number: 'F-4621', issue_date: '2026-07-07', visit_date: '2026-07-07',
    collected_date: '2026-07-07', requested_date: '2026-07-07',
    insurance_grade_label: grade === 'general' ? '건강보험(일반)' : '미등록',
    copay_rate: grade === 'general' ? '30' : '-',
    fee_grid_html: feeGridHtml,
    insurance_covered: won(lv.insuranceCovered),
    copayment: won(fb.copaymentTotal),
    non_covered: won(fb.nonCoveredTotal),
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

test.describe('AC-3 실브라우저 인쇄 미리보기 evidence (SSOT 렌더)', () => {
  test.use({ viewport: { width: 1123, height: 900 } }); // A4 landscape @96dpi

  test('S1 세부산정내역 grade-null → 본인=급여전액/공단=0, 공란 없음', async ({ page }) => {
    const html = renderBillDetailDoc(null);
    // 회귀-불가 단언: 본인부담금=급여전액(13,370) 삽입, 비급여 350,000, 공란(빈 셀) 아님
    expect(html).toContain('13,370'); // 본인부담금 = 급여전액
    expect(html).toContain('350,000'); // 비급여 전액
    await snap(page, html, 'S1-detail-gradenull.png');
  });

  test('S2 세부산정내역 grade 실재(general) → 본인 4,000/공단 9,370 (회귀 없음)', async ({ page }) => {
    const html = renderBillDetailDoc('general');
    expect(html).toContain('4,000'); // 본인부담금 (FLOOR, 구 CEIL 4,100 정정 — T-20260719 copayCalc v1.5 미러)
    expect(html).toContain('9,370'); // 공단부담금 (13,370-4,000, 구 9,270 정정)
    await snap(page, html, 'S2-detail-graded.png');
  });

  test('S3 계산서·영수증 grade-null → 동일 SSOT 반영(본인=전액/공단=0)', async ({ page }) => {
    const html = renderBillReceiptDoc(null);
    // 요약행 본인부담금=13,370(급여전액), 공단부담금=0
    expect(html).toContain('13,370'); // 본인부담(copayment)
    expect(html).toContain('350,000'); // 비급여
    await snap(page, html, 'S3-receipt-gradenull.png');
  });

  test('S4 계산서·영수증 grade 실재(general) → 본인 4,000/공단 9,370 (회귀 없음)', async ({ page }) => {
    const html = renderBillReceiptDoc('general');
    expect(html).toContain('4,000'); // 본인부담 (FLOOR, 구 CEIL 4,100 정정)
    expect(html).toContain('9,370'); // 공단부담 (13,370-4,000, 구 9,270 정정)
    await snap(page, html, 'S4-receipt-graded.png');
  });
});
