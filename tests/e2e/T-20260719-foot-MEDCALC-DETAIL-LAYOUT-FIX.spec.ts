/**
 * T-20260719-foot-MEDCALC-DETAIL-LAYOUT-FIX
 *   진료비 세부산정내역(bill_detail) 하단 3행 수정 — 김주연 총괄(풋센터) 현장 피드백.
 *   reporter 결정 A안 확정(2026-07-19 21:36, slack ts 1784464562.076939):
 *     계 총액 열 & 합계 = 본인부담 + 비급여 (공단 제외, GONGDAN-HIDE B안 canon 유지).
 *
 * AC:
 *   AC-①: '계' 행 — 각 열(본인부담금/공단부담금/전액본인부담/비급여/총액, 5개 열 전부) 세로 합산값 표시.
 *          총액 열 = 본인부담 + 비급여(공단 제외, A안). item 행 총액(본인+공단+비급여) 산술합과는 공단분 차이=정상.
 *   AC-②: '끝처리 조정금액' — 10원 단위 절사 차액 = floor(계/10)*10 - 계 (≤0). 종전 하드코드 0 → 실계산.
 *          diagnose-first: copayment 100원 절사와 이중적용/중복상쇄 없음(직교 레벨).
 *   AC-③: '합계' 행 — (본인부담금 + 비급여) 를 끝처리 조정 반영 후 표시 + 셀 병합(colspan=5) + 중앙정렬.
 *
 * SSOT = footBilling.computeBillDetailRounding + DocumentPrintPanel/PaymentMiniWindow 6개 렌더 경로.
 * 건보 산출로직·집계 grain 무변경 — 순수 출력 표시/파생 계산.
 *
 * 실행: npx playwright test --project=unit T-20260719-foot-MEDCALC-DETAIL-LAYOUT-FIX
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
  'claude-sync/memory/_handoff/qa_screenshots/T-20260719-foot-MEDCALC-DETAIL-LAYOUT-FIX',
);

const svc = (over: Partial<BillingService> & { id: string; name: string }): BillingService => ({
  service_code: null, hira_code: null, vat_type: 'none',
  is_insurance_covered: false, category_label: null, price: 0, ...over,
});

// 급여(재진진찰료 AA254 13,370, general 30%) + 비급여(레이저 350,000) 혼합.
const MIXED_VISIT: FootBillingItem[] = [
  { service: svc({ id: 'c1', name: '재진진찰료-의원', service_code: 'AA254', hira_code: 'AA254', is_insurance_covered: true, category_label: '기본', price: 13370 }), qty: 1, unitPrice: 13370 },
  { service: svc({ id: 's1', name: '가열성 진균증 레이저 치료', service_code: 'SZ035', is_insurance_covered: false, category_label: '풋케어', price: 350000 }), qty: 1, unitPrice: 350000 },
];

const won = (n: number) => n.toLocaleString('ko-KR');
const VISIT_DATE = '2026-07-19';

/** DocumentPrintPanel/PaymentMiniWindow bill_detail 바인딩 replay (A안 canon). */
function bindDetail(items: FootBillingItem[], grade: 'general' | null) {
  const fb = computeFootBilling(items, grade);
  const v: Record<string, string> = {};
  const billItems = buildFootBillDetailItems(fb.pricingItems, VISIT_DATE, {
    insuranceGrade: grade, copaymentTotal: fb.copaymentTotal,
  });
  v.items_html = buildBillDetailItemsHtml(billItems);
  // 계 행 열별 세로합 (AC-①, 5개 열)
  v.subtotal_copayment = formatAmount(fb.copaymentTotal);
  v.subtotal_fund = formatAmount(fb.liveBillingValues.insuranceCovered);
  v.subtotal_noncovered = won(fb.nonCoveredTotal);
  // 계 총액(절사 전) / 끝처리 조정 / 합계(절사 후)
  const payable = fb.copaymentTotal + fb.nonCoveredTotal;
  const { adjustment, roundedTotal } = computeBillDetailRounding(payable);
  v.detail_subtotal = formatAmount(payable);
  v.detail_rounding = formatAmount(adjustment);
  v.detail_total = formatAmount(roundedTotal);
  return { fb, v, payable, adjustment, roundedTotal };
}

test.beforeAll(() => { fs.mkdirSync(OUT_DIR, { recursive: true }); });

// ── AC-②: 끝자리 조정 산식(10원 절사) 단위 잠금 ──
test('AC-②: computeBillDetailRounding = floor(payable/10)*10 - payable (10원 절사, ≤0)', () => {
  // 10원 배수 → 조정 0 (ticket 예: 308,800 → 0)
  expect(computeBillDetailRounding(308800)).toEqual({ adjustment: 0, roundedTotal: 308800 });
  // 우수리 존재 → 음수 조정 + 절사 후 총액
  expect(computeBillDetailRounding(308844)).toEqual({ adjustment: -4, roundedTotal: 308840 });
  expect(computeBillDetailRounding(308848)).toEqual({ adjustment: -8, roundedTotal: 308840 });
  expect(computeBillDetailRounding(5)).toEqual({ adjustment: -5, roundedTotal: 0 });
  // 방어: 0/음수/비정상 → 0
  expect(computeBillDetailRounding(0)).toEqual({ adjustment: 0, roundedTotal: 0 });
  expect(computeBillDetailRounding(-100)).toEqual({ adjustment: 0, roundedTotal: 0 });
});

// ── AC-② diagnose-first: copayment 100원 절사와 10원 절사 이중적용/중복상쇄 없음 ──
test('AC-②-diagnose: 10원 절사는 payable(본인+비급여) 합에만 적용 — copayment 컬럼 불변', () => {
  const { fb, v, payable } = bindDetail(MIXED_VISIT, 'general');
  // copayment(본인부담금)는 이미 100원 절사된 값 — 계 본인부담금 열은 그대로(추가 절사 없음)
  expect(v.subtotal_copayment).toBe(formatAmount(fb.copaymentTotal));
  expect(fb.copaymentTotal % 100).toBe(0); // 100원 배수(FLOOR canon)
  // 계 총액(절사 전) = 본인 + 비급여 (공단 제외) — 10원 절사 미적용
  expect(v.detail_subtotal).toBe(won(payable));
  expect(payable).toBe(fb.copaymentTotal + fb.nonCoveredTotal);
  // 합계(절사 후)는 payable 을 10원 절사한 값 — copaymentTotal 을 다시 절사하지 않음
  const { roundedTotal } = computeBillDetailRounding(payable);
  expect(v.detail_total).toBe(won(roundedTotal));
});

// ── AC-①: 계 행 5개 열 세로합 전부 표시(공란 아님) + 총액 = 본인+비급여(공단 제외) ──
test('AC-①: 계 행 5개 열(본인/공단/전액/비급여/총액) 세로합 표시 + 총액=본인+비급여', () => {
  const { fb, v } = bindDetail(MIXED_VISIT, 'general');
  // 5개 열 중 4개 데이터 열 채움(전액본인부담은 foot 미사용=0, 템플릿 상수)
  expect(v.subtotal_copayment).toBeTruthy();
  expect(v.subtotal_fund).toBeTruthy();
  expect(v.subtotal_noncovered).toBeTruthy();
  expect(v.detail_subtotal).toBeTruthy();
  // 총액(A안) = 본인부담 + 비급여, 공단 제외
  expect(v.detail_subtotal).toBe(won(fb.copaymentTotal + fb.nonCoveredTotal));
  // 공단 표기 유지(계 행) — GONGDAN-HIDE B안 정합
  expect(v.subtotal_fund).toBe(formatAmount(fb.liveBillingValues.insuranceCovered));

  const html = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, v);
  // 계 행: 총액/본인/공단/비급여 셀이 렌더에 존재(공란 아님)
  expect(html).toContain(`<td class="num-cell">${won(fb.copaymentTotal + fb.nonCoveredTotal)}</td>`);
  expect(html).toContain(won(fb.copaymentTotal));
  expect(html).toContain(won(fb.liveBillingValues.insuranceCovered));
  expect(html).toContain(won(fb.nonCoveredTotal));
});

// ── AC-③: 합계 행 병합(colspan=5)+중앙정렬 + = 본인+비급여(절사 후) ──
test('AC-③: 합계 행 = 병합(colspan=5) 중앙정렬 단일 셀 = 본인+비급여(절사 후)', () => {
  const { v, roundedTotal } = bindDetail(MIXED_VISIT, 'general');
  const tpl = getHtmlTemplate('bill_detail')!;
  // 템플릿 정적 구조: 병합+중앙정렬 단일 셀
  expect(tpl).toContain('<td colspan="5" class="num-cell" style="text-align:center;"><strong>{{detail_total}}</strong></td>');
  // '끝처리 조정금액' 은 detail_rounding 바인딩(AC-②)
  expect(tpl).toContain('{{detail_rounding}}');

  const html = bindHtmlTemplate(tpl, v);
  expect(html).toContain(`<td colspan="5" class="num-cell" style="text-align:center;"><strong>${won(roundedTotal)}</strong></td>`);
  // 합계 행에 per-column total_fund 잔존 셀 없음(병합됨) — 공란 회귀 아님
  expect(html).not.toContain('<td colspan="5" class="num-cell" style="text-align:center;"><strong></strong></td>');
});

// ── AC-③ 렌더: 실브라우저 인쇄 미리보기 — 합계 병합 셀 가시 + 중앙정렬 ──
test('AC-③ 렌더: 합계 병합 셀이 실제 표에서 5칸 span + 중앙정렬로 보임', async ({ page }) => {
  const { v, roundedTotal } = bindDetail(MIXED_VISIT, 'general');
  const html = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, v);
  await page.emulateMedia({ media: 'print' });
  await page.setContent(`<div style="width:1050px;padding:16px;">${html}</div>`);
  const sumCell = page.locator('td[colspan="5"]').filter({ hasText: won(roundedTotal) }).first();
  await expect(sumCell).toBeVisible();
  await expect(sumCell).toHaveCSS('text-align', 'center');
  await expect(page.locator('text=끝처리 조정금액').first()).toBeVisible();
  await page.screenshot({ path: path.join(OUT_DIR, 'medcalc-detail-summary.png'), fullPage: true });
});
