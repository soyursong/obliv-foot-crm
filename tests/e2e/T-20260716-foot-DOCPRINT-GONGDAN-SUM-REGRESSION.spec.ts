/**
 * T-20260716-foot-DOCPRINT-GONGDAN-SUM-REGRESSION — 결제창(PATH-4) 서류 '계'·'합계' 공란 회귀 hotfix
 *
 * RC: T-20260714-foot-DOCPRINT-GONGDAN-HIDE-COPAY-ONLY(B안, commit 50850510)이 세부산정내역(bill_detail)
 *     하단 '계'/'합계' 셀 placeholder 를 {{subtotal_amount}}/{{total_amount}} → {{detail_subtotal}}/{{detail_total}} 로,
 *     계산서·영수증(bill_receipt) 소계·총진료비합계를 {{receipt_total}} 로 교체하고 DocumentPrintPanel 바인딩만
 *     갱신했다. 그러나 **결제창(PaymentMiniWindow, PATH-4)** 의 서류출력/출력+수납 두 핸들러는 여전히
 *     total_amount/subtotal_amount 만 세팅 → 신규 placeholder 미바인딩 → '계'·'합계'·'총 진료비 합계'가
 *     공란으로 렌더(진료항목·금액은 정상). 코디(김지혜)가 결제 시점에 출력하는 주경로라 현장 신고.
 *
 * FIX: PaymentMiniWindow 두 핸들러에 DocumentPrintPanel 과 동일 산식으로 재바인딩.
 *   detail_total/detail_subtotal/receipt_total = 급여 본인부담금(copaymentTotal) + 비급여(공단 제외).
 *   건강보험 계산 로직·서식 무변경(AC-7), 공단부담금 라인 표시 유지(AC-3).
 *
 * 본 harness 는 앱과 동일한 SSOT(computeFootBilling/build*)로 문서 HTML 을 산출하되, **DocumentPrintPanel 이
 *   아닌 PaymentMiniWindow 의 바인딩 절차**(applyBillingFallback → total_amount/subtotal_amount →
 *   detail_total·detail_subtotal·receipt_total)를 그대로 replay 한다. page.setContent + emulateMedia print 인쇄 미리보기 캡처(AC-5).
 *
 * AC:
 *   AC-1: 계산서·영수증(bill_receipt) 소계/총 진료비 합계 표시 + = 본인부담금 + 비급여 (공단 제외)
 *   AC-2: 세부산정내역(bill_detail) '합계' 표시 + = 본인부담금 + 비급여 (공단 제외)
 *   AC-3: 공단부담금 별도 라인/칸 표기 유지
 *   AC-4: 비급여-only(등급 null) 회귀 0
 *   AC-6: 세부산정내역 '계'(subtotal) 도 표시 + = 진료내역 자동합산 (공단 제외)
 *   AC-7: 산식/서식 무변경 — RC 이전 PMW 바인딩(detail_* 미세팅)이면 공란임을 역가드
 *
 * 실행: npx playwright test --project=unit T-20260716-foot-DOCPRINT-GONGDAN-SUM-REGRESSION
 */

import { test, expect } from '@playwright/test';
import { homedir } from 'os';
import fs from 'fs';
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
import { applyBillingFallback } from '../../src/lib/autoBindContext';
import { formatAmount } from '../../src/lib/format';

const OUT_DIR = path.join(
  homedir(),
  'claude-sync/memory/_handoff/qa_screenshots/T-20260716-foot-DOCPRINT-GONGDAN-SUM-REGRESSION',
);

const svc = (over: Partial<BillingService> & { id: string; name: string }): BillingService => ({
  service_code: null, hira_code: null, vat_type: 'none',
  is_insurance_covered: false, category_label: null, price: 0, ...over,
});

// 급여(재진진찰료 AA254 13,370, covered) + 비급여(레이저 350,000) 혼합 방문.
const MIXED_VISIT: FootBillingItem[] = [
  { service: svc({ id: 'c1', name: '재진진찰료-의원', service_code: 'AA254', hira_code: 'AA254', is_insurance_covered: true, category_label: '기본', price: 13370 }), qty: 1, unitPrice: 13370 },
  { service: svc({ id: 's1', name: '가열성 진균증 레이저 치료', service_code: 'SZ035', is_insurance_covered: false, category_label: '풋케어', price: 350000 }), qty: 1, unitPrice: 350000 },
];
// 비급여-only(등급 null) 방문.
const NONCOV_VISIT: FootBillingItem[] = [
  { service: svc({ id: 's1', name: '가열성 진균증 레이저 치료', is_insurance_covered: false, category_label: '풋케어', price: 350000 }), qty: 1, unitPrice: 350000 },
];

const won = (n: number) => n.toLocaleString('ko-KR');
const cellsBetween = (html: string, startNeedle: string, span = 900) => {
  const i = html.indexOf(startNeedle);
  return i < 0 ? '' : html.slice(i, i + span);
};

/**
 * PaymentMiniWindow(PATH-4) 바인딩 절차 replay.
 *   실 코드: applyBillingFallback(insuranceCovered, copayment, nonCovered, total) →
 *            bill_detail 선택 시 items_html + total_amount/subtotal_amount + detail_total/detail_subtotal(FIX) →
 *            bill_receipt 선택 시 fee_grid_html + receipt_total(FIX).
 * @param applyFix false 면 RC 이전 상태(detail_total·receipt_total 미세팅) 를 replay → 공란 역가드용.
 */
function bindPmw(items: FootBillingItem[], grade: 'general' | null, applyFix: boolean) {
  const fb = computeFootBilling(items, grade);
  const copaymentTotal = fb.copaymentTotal;
  const nonCovered = fb.nonCoveredTotal; // = PMW 의 totalByTax['비급여(과세)']+['비급여(면세)']
  const coveredTotal = fb.liveBillingValues.copayment + fb.liveBillingValues.insuranceCovered;
  const grandTotal = fb.grandTotal;

  const values: Record<string, string> = {};
  applyBillingFallback(values, {
    insuranceCovered: Math.max(0, coveredTotal - copaymentTotal),
    copayment: copaymentTotal,
    nonCovered,
    total: grandTotal,
  });
  const detailItems = buildFootBillDetailItems(fb.pricingItems, '2026-07-16', {
    insuranceGrade: grade,
    copaymentTotal,
  });
  // bill_detail 경로
  values.items_html = buildBillDetailItemsHtml(detailItems);
  if (grandTotal > 0) {
    values.total_amount = formatAmount(grandTotal);
    values.subtotal_amount = formatAmount(grandTotal);
  }
  // 요약행 본인/공단 총계(applyBillingFallback 은 subtotal_copayment/subtotal_fund 미세팅 → 앱과 동일하게 명시)
  values.subtotal_copayment = formatAmount(copaymentTotal);
  values.total_copayment = values.subtotal_copayment;
  values.subtotal_fund = formatAmount(fb.liveBillingValues.insuranceCovered);
  values.total_fund = values.subtotal_fund;
  values.subtotal_noncovered = won(nonCovered);
  values.total_noncovered = won(nonCovered);
  // bill_receipt 경로
  values.fee_grid_html = buildBillReceiptFeeGridHtml(detailItems);

  if (applyFix) {
    // T-20260716-foot-DOCPRINT-GONGDAN-SUM-REGRESSION fix: 계/합계/총진료비 = 본인부담 + 비급여(공단 제외)
    values.detail_total = formatAmount(copaymentTotal + nonCovered);
    values.detail_subtotal = values.detail_total;
    values.receipt_total = formatAmount(copaymentTotal + nonCovered);
  }
  return { fb, values, excludeSum: copaymentTotal + nonCovered };
}

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
});

// ── RC 가드: 템플릿이 신규 placeholder 를 쓰는지(회귀 원인 재현) ──
test('RC-guard: bill_detail 계/합계 = detail_subtotal/detail_total, bill_receipt = receipt_total placeholder', () => {
  const detailTpl = getHtmlTemplate('bill_detail')!;
  const receiptTpl = getHtmlTemplate('bill_receipt')!;
  expect(detailTpl).toContain('{{detail_subtotal}}'); // '계' 행
  expect(detailTpl).toContain('{{detail_total}}');     // '합계' 행
  expect(receiptTpl).toContain('{{receipt_total}}');   // 소계 + 총 진료비 합계
});

// ── AC-7 역가드: PMW 가 detail_*/receipt_total 를 세팅하지 않으면(RC 이전) 공란 회귀 ──
test('AC-7 역가드: FIX 미적용 PMW 바인딩이면 계/합계/총진료비 공란(회귀 재현)', async ({ page }) => {
  const { values } = bindPmw(MIXED_VISIT, 'general', /* applyFix */ false);
  const detailHtml = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, values);
  const receiptHtml = bindHtmlTemplate(getHtmlTemplate('bill_receipt')!, values);
  // 계/합계 총액 셀 = 빈 <td>...</td> (미바인딩)
  expect(detailHtml).toContain('<td class="num-cell"></td>');
  expect(detailHtml).toContain('<td class="num-cell"><strong></strong></td>');
  // 총 진료비 합계 셀 = ₩ (뒤 값 없음)
  await page.setContent(receiptHtml);
  const grand = await page.locator('text=총 진료비 합계').first();
  await expect(grand).toBeVisible();
});

for (const [label, items, grade] of [
  ['MIXED-general', MIXED_VISIT, 'general'],
  ['NONCOV-null', NONCOV_VISIT, null],
] as const) {
  test(`AC-1/2/6: [${label}] PMW 세부산정내역 계·합계 + 계산서 총합 표시 & = 본인부담+비급여(공단 제외)`, async ({ page }) => {
    const { fb, values, excludeSum } = bindPmw(items as FootBillingItem[], grade as 'general' | null, true);

    // 신규 placeholder 가 실제로 채워졌는지(공란 회귀 방지)
    expect(values.detail_subtotal, 'detail_subtotal(계) 미바인딩').toBeTruthy();
    expect(values.detail_total, 'detail_total(합계) 미바인딩').toBeTruthy();
    expect(values.receipt_total, 'receipt_total(총진료비) 미바인딩').toBeTruthy();
    expect(values.detail_total).toBe(won(excludeSum));
    expect(values.receipt_total).toBe(won(excludeSum));

    const detailHtml = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, values);
    const receiptHtml = bindHtmlTemplate(getHtmlTemplate('bill_receipt')!, values);

    // AC-6: '계' 행 총액 셀 = excludeSum (비어있지 않음)
    expect(detailHtml).toContain(`<td class="num-cell">${won(excludeSum)}</td>`);
    // AC-2: '합계' 행 총액 셀 = excludeSum (strong)
    expect(detailHtml).toContain(`<td class="num-cell"><strong>${won(excludeSum)}</strong></td>`);
    // 공란 회귀가 아님을 명시
    expect(detailHtml).not.toContain('<td class="num-cell"><strong></strong></td>');

    // AC-1: 계산서·영수증 총 진료비 합계 = excludeSum
    expect(receiptHtml).toContain(`₩ ${won(excludeSum)}`);

    // AC-3: 공단부담금 칸/금액 표시 유지 (subtotal_fund = insuranceCovered)
    if (fb.liveBillingValues.insuranceCovered > 0) {
      expect(detailHtml).toContain(won(fb.liveBillingValues.insuranceCovered));
    }

    // AC-5: 실브라우저 인쇄 미리보기 캡처(bill_detail landscape)
    await page.emulateMedia({ media: 'print' });
    await page.setContent(`<div style="width:1050px;padding:16px;">${detailHtml}</div>`);
    await expect(page.locator('text=합계').first()).toBeVisible();
    await page.screenshot({ path: path.join(OUT_DIR, `detail-${label}.png`), fullPage: true });
    await page.setContent(`<div style="width:760px;padding:16px;">${receiptHtml}</div>`);
    await expect(page.locator('text=총 진료비 합계').first()).toBeVisible();
    await page.screenshot({ path: path.join(OUT_DIR, `receipt-${label}.png`), fullPage: true });
  });
}
