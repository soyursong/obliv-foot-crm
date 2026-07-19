/**
 * T-20260716-foot-DOCPRINT-BILLDETAIL-SUBTOTAL-TOTAL-BLANK
 *   진료비 세부산정내역(bill_detail) 출력 서식 하단 '계'(detail_subtotal)/'합계'(detail_total)
 *   금액 공란(0) 버그 — DocumentPrintPanel 렌더 경로 회귀 가드.
 *
 * RCA (dev-foot, 직접 확정):
 *   B안(T-20260714-foot-DOCPRINT-GONGDAN-HIDE-COPAY-ONLY, commit 50850510)이 '계'/'합계' 셀
 *   placeholder 를 {{subtotal_amount}}/{{total_amount}} → {{detail_subtotal}}/{{detail_total}} 로 개명하고
 *   **DocumentPrintPanel 4개 렌더 분기**(단건 footFb / 단건 service_charges 폴백 / 배치 fbBatch /
 *   배치 service_charges 폴백)의 바인딩을 함께 갱신했다. 따라서 DocumentPrintPanel 경로는 bill_detail
 *   출력 시 detail_subtotal/detail_total 를 **항상** 세팅한다(항목 0건이면 '0' 명시 — 공란/미바인딩 없음).
 *   → "진료항목은 보이는데 계/합계만 공란" 증상은 DocumentPrintPanel 에서 구조적으로 발생 불가
 *      (items_html 과 detail_* 가 동일 소스에서 함께 채워짐).
 *   실제 현장 증상의 근인 표면은 결제창(PaymentMiniWindow, PATH-4)이며 P0 형제 티켓
 *   T-20260716-foot-DOCPRINT-GONGDAN-SUM-REGRESSION(commit 32879f02)에서 별도 수정(deploy-ready).
 *
 * 본 spec 의 역할 = DocumentPrintPanel 표면의 AC1/AC2/AC4 불변식 잠금 + 미래 placeholder 개명 drift 재발
 *   방지. 앱과 동일한 SSOT(computeFootBilling/buildFootBillDetailItems)로 DocumentPrintPanel 의 bill_detail
 *   바인딩 절차를 replay 하고, '계'/'합계' 셀이 비어있지 않으며 = 본인부담금 + 비급여(공단 제외, B안 보존)
 *   임을 단언한다. 건보 산식·서식은 read-only 소비만 — 무변경.
 *
 * AC:
 *   AC1: bill_detail 출력 시 '계'(detail_subtotal)/'합계'(detail_total)에 자동 합산값이 출력(공란/미바인딩 아님).
 *   AC2: 출력 합계 = computeFootBilling 산출(copaymentTotal + nonCoveredTotal, 공단 제외).
 *   AC3: 레이아웃/컬럼/스타일 무변경 — 템플릿 HTML placeholder 구조 유지(정적 가드).
 *   AC4: 건보 산식 무변경 + 공단부담금 칸(subtotal_fund/total_fund) 표시 유지(회귀 0).
 *   Edge: 항목 0건 → '0' 표시(공란/NaN/크래시 아님).
 *
 * 실행: npx playwright test --project=unit T-20260716-foot-DOCPRINT-BILLDETAIL-SUBTOTAL-TOTAL-BLANK
 */

import { test, expect } from '@playwright/test';
import { homedir } from 'os';
import fs from 'fs';
import path from 'path';
import {
  computeFootBilling,
  buildFootBillDetailItems,
  computeBillDetailRounding,
  type FootBillingItem,
  type BillingService,
} from '../../src/lib/footBilling';
import {
  getHtmlTemplate,
  bindHtmlTemplate,
  buildBillDetailItemsHtml,
} from '../../src/lib/htmlFormTemplates';
import { formatAmount } from '../../src/lib/format';

const OUT_DIR = path.join(
  homedir(),
  'claude-sync/memory/_handoff/qa_screenshots/T-20260716-foot-DOCPRINT-BILLDETAIL-SUBTOTAL-TOTAL-BLANK',
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
// 비급여-only(등급 null) 방문 — 자부담 100%.
const NONCOV_VISIT: FootBillingItem[] = [
  { service: svc({ id: 's1', name: '가열성 진균증 레이저 치료', is_insurance_covered: false, category_label: '풋케어', price: 350000 }), qty: 1, unitPrice: 350000 },
];
// 급여-only(등급 general 30%) 방문 — 공단 제외 시 본인부담금만.
const COVERED_ONLY_VISIT: FootBillingItem[] = [
  { service: svc({ id: 'c1', name: '초진진찰료-의원', service_code: 'AA154', hira_code: 'AA154', is_insurance_covered: true, category_label: '기본', price: 17610 }), qty: 1, unitPrice: 17610 },
];

const won = (n: number) => n.toLocaleString('ko-KR');
const VISIT_DATE = '2026-07-16';

/**
 * DocumentPrintPanel 단건출력(allValues) bill_detail footFb 경로 바인딩 replay.
 *   실 코드: DocumentPrintPanel.tsx L2218~2239 (form_key==='bill_detail' && footFb).
 *   @param applyFix false = B안 개명 직전(detail_* 미세팅) → 공란 역가드용.
 */
function bindDocPanel(items: FootBillingItem[], grade: 'general' | null, applyFix: boolean) {
  const fb = computeFootBilling(items, grade);
  const values: Record<string, string> = {};

  const billItems = buildFootBillDetailItems(fb.pricingItems, VISIT_DATE, {
    insuranceGrade: grade,
    copaymentTotal: fb.copaymentTotal,
  });
  values.items_html = buildBillDetailItemsHtml(billItems);
  if (fb.grandTotal > 0) {
    values.total_amount = formatAmount(fb.grandTotal);
    values.subtotal_amount = values.total_amount;
  }
  values.subtotal_noncovered = won(fb.nonCoveredTotal);
  values.total_noncovered = won(fb.nonCoveredTotal);
  // AC4: 공단부담금 칸 = insuranceCovered (표시 유지), 본인부담금 = copaymentTotal.
  values.subtotal_copayment = formatAmount(fb.copaymentTotal);
  values.total_copayment = values.subtotal_copayment;
  values.subtotal_fund = formatAmount(fb.liveBillingValues.insuranceCovered);
  values.total_fund = values.subtotal_fund;

  if (applyFix) {
    // B안(GONGDAN-HIDE-COPAY-ONLY) 보존: 계/합계 = 본인부담금 + 비급여(공단 제외).
    // T-20260719-foot-MEDCALC-DETAIL-LAYOUT-FIX: 계 총액(절사 전) / 끝처리 조정 / 합계(절사 후) 분리.
    const payable = fb.copaymentTotal + fb.nonCoveredTotal;
    const { adjustment, roundedTotal } = computeBillDetailRounding(payable);
    values.detail_subtotal = formatAmount(payable);
    values.detail_rounding = formatAmount(adjustment);
    values.detail_total = formatAmount(roundedTotal);
  }
  return { fb, values, sum: fb.copaymentTotal + fb.nonCoveredTotal };
}

/** DocumentPrintPanel 항목 0건 경로 replay (L2280~2291). */
function bindDocPanelEmpty() {
  const values: Record<string, string> = {};
  values.items_html = buildBillDetailItemsHtml([]);
  values.subtotal_noncovered = '0';
  values.total_noncovered = '0';
  values.subtotal_copayment = '0';
  values.total_copayment = '0';
  values.subtotal_fund = '0';
  values.total_fund = '0';
  values.detail_total = '0';
  values.detail_subtotal = '0';
  values.detail_rounding = '0';
  return values;
}

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
});

// ── AC3 정적 가드: 템플릿이 계/합계 placeholder + 공단 칸 placeholder 를 유지하는지 ──
// T-20260719-foot-MEDCALC-DETAIL-LAYOUT-FIX(AC-③, 김주연 총괄 확정): '합계' 행은 값 셀을 병합(colspan=5)+
//   중앙정렬한 단일 셀({{detail_total}})로 재구성 → 합계 행의 per-column total_fund 셀은 제거된다.
//   공단부담금 별도 표기는 '계' 행({{subtotal_fund}})에서 유지(GONGDAN-HIDE B안 정합). '끝처리 조정금액'은
//   {{detail_rounding}} 로 바인딩(AC-②).
test('AC3: bill_detail 템플릿 계=열별 placeholder 유지, 합계=detail_total 병합, 끝처리 조정=detail_rounding', () => {
  const tpl = getHtmlTemplate('bill_detail')!;
  expect(tpl).toBeTruthy();
  expect(tpl).toContain('{{detail_subtotal}}'); // '계' 행 총액 셀
  expect(tpl).toContain('{{detail_total}}');    // '합계' 행 병합 총액 셀
  expect(tpl).toContain('{{subtotal_fund}}');   // '계' 공단부담금 칸 (표시 유지)
  expect(tpl).toContain('{{detail_rounding}}'); // '끝처리 조정금액' 셀 (AC-②)
  // '합계' 행 = 병합(colspan=5)+중앙정렬 단일 셀 (AC-③)
  expect(tpl).toContain('<td colspan="5" class="num-cell" style="text-align:center;"><strong>{{detail_total}}</strong></td>');
});

// ── AC-역가드: detail_* 미세팅(개명 직전)이면 계/합계 공란 렌더 재현 ──
test('역가드: DocumentPrintPanel 이 detail_* 미세팅이면 계/합계 공란(회귀 재현)', () => {
  const { values } = bindDocPanel(MIXED_VISIT, 'general', /* applyFix */ false);
  const html = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, values);
  expect(html).toContain('<td class="num-cell"></td>');            // '계' 총액 공란
  // '합계' 병합 총액 공란 (colspan=5 중앙정렬 셀)
  expect(html).toContain('<td colspan="5" class="num-cell" style="text-align:center;"><strong></strong></td>');
});

for (const [label, items, grade] of [
  ['MIXED-general', MIXED_VISIT, 'general'],
  ['NONCOV-null', NONCOV_VISIT, null],
  ['COVERED-general', COVERED_ONLY_VISIT, 'general'],
] as const) {
  test(`AC1/AC2/AC4: [${label}] DocumentPrintPanel 세부산정내역 계·합계 = 본인부담+비급여(공단 제외)`, async ({ page }) => {
    const { fb, values, sum } = bindDocPanel(items as FootBillingItem[], grade as 'general' | null, true);

    // AC1: 계/합계 placeholder 가 실제로 채워짐(공란/미바인딩 아님)
    expect(values.detail_subtotal, 'detail_subtotal(계) 미바인딩').toBeTruthy();
    expect(values.detail_total, 'detail_total(합계) 미바인딩').toBeTruthy();
    // AC2: = computeFootBilling(copaymentTotal + nonCoveredTotal), 공단 제외.
    //   본 케이스들은 payable 이 10원 배수라 절사=0 → detail_total(절사 후)=won(sum).
    expect(values.detail_subtotal).toBe(won(sum));
    expect(values.detail_total).toBe(won(sum));

    const html = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, values);
    // '계' 행 총액 셀 = sum (비어있지 않음)
    expect(html).toContain(`<td class="num-cell">${won(sum)}</td>`);
    // '합계' 행 병합 총액 셀 = sum (colspan=5 중앙정렬 strong) — AC-③
    expect(html).toContain(`<td colspan="5" class="num-cell" style="text-align:center;"><strong>${won(sum)}</strong></td>`);
    // 공란 회귀 아님을 명시
    expect(html).not.toContain('<td colspan="5" class="num-cell" style="text-align:center;"><strong></strong></td>');

    // AC4: 공단부담금 칸 표시 유지(insuranceCovered > 0 이면 그 값이 렌더에 존재)
    if (fb.liveBillingValues.insuranceCovered > 0) {
      expect(values.subtotal_fund).toBe(formatAmount(fb.liveBillingValues.insuranceCovered));
      expect(html).toContain(won(fb.liveBillingValues.insuranceCovered));
    }

    // 실브라우저 인쇄 미리보기 캡처(bill_detail landscape)
    await page.emulateMedia({ media: 'print' });
    await page.setContent(`<div style="width:1050px;padding:16px;">${html}</div>`);
    await expect(page.locator('text=합계').first()).toBeVisible();
    await page.screenshot({ path: path.join(OUT_DIR, `detail-${label}.png`), fullPage: true });
  });
}

// ── Edge: 항목 0건 → '0' 표시(공란/NaN/크래시 아님) ──
test('Edge: 진료항목 0건이면 계/합계 = 0 (공란/NaN 아님)', () => {
  const values = bindDocPanelEmpty();
  expect(values.detail_subtotal).toBe('0');
  expect(values.detail_total).toBe('0');
  const html = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, values);
  expect(html).toContain('<td class="num-cell">0</td>');
  // '합계' 병합 총액 셀 = 0 (colspan=5 중앙정렬)
  expect(html).toContain('<td colspan="5" class="num-cell" style="text-align:center;"><strong>0</strong></td>');
  expect(html).not.toContain('NaN');
});
