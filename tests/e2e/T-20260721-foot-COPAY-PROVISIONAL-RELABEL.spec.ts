/**
 * E2E spec — T-20260721-foot-COPAY-PROVISIONAL-RELABEL
 * 풋센터 진료비 서류 3종 급여항목 본인부담 확정 라벨 「본인부담금」 재라벨 (§2-2-6 제3안 B, DA GO).
 *
 * 현장(김주연 총괄 confirm, slack ts 1784600235): 확정 문구 = `본인부담금`.
 *   (제안 "잠정 본인부담 (보험등급 확정 후 정산)"에서 현장 친화로 정정.)
 *
 * 배경: 영수증(공단0=전액본인) vs 결제미니창(30% 잠정) 금액 불일치 → "영수증이 틀렸다" 오독.
 *   해소 = 서류 급여항목 환자 부담분을 「본인부담금」으로 명시하는 설명 라인 추가.
 *
 * BINDING (DA qczv, 필수 준수):
 *   ① 법정 별지 서식 필수 칸 canon 불변 — 본인부담금 칸=전액, 공단부담금 칸=0, 칸 구조·칸명 무접촉.
 *     재라벨은 법정 필수 칸 밖(문서 요약/설명 라인·비고) 텍스트 레이어에만.
 *   ② 어떤 숫자도 신설/변경 금지 (db_change=false, 계산·스키마·바인딩 산식 무변경).
 *
 * 법정서식 적합성 검토(dev-foot 확정 배치):
 *   - bill_detail(세부산정내역, 별지 제1호): 하단 신청인 문구 위 설명 라인.
 *   - bill_receipt(계산서·영수증 레거시): 하단 주의(.br-notice) 영역.
 *   - bill_receipt_new(계산서·영수증 별지 제6호): 하단 안내표 아래 설명 라인.
 *   세 곳 모두 법정 필수 칸/그리드 밖 — 정적 텍스트만, 숫자 렌더 0.
 *
 * 시나리오(AC 기준):
 *   시나리오1: grade=null 급여 방문 — 서류 3종에 확정 라벨 「본인부담금」 노출 + 공단부담금 칸=0(불변)
 *              + 합계 = 종전 산식 동일(무변경) 확인.
 *   시나리오2: insurance_grade 확정(non-null) 환자 서류 출력 — 라벨 정책 정합(동일 노출) 확인.
 *   canon-guard: 법정 그리드 칸명(본인부담금/공단부담금/전액본인부담) 헤더 유지 + 신규 숫자 미도입.
 *
 * 실행: npx playwright test --project=unit T-20260721-foot-COPAY-PROVISIONAL-RELABEL
 */

import { test, expect } from '@playwright/test';
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
  buildBillReceiptFeeGridHtml,
} from '../../src/lib/htmlFormTemplates';
import { applyBillingFallback } from '../../src/lib/autoBindContext';
import { formatAmount } from '../../src/lib/format';

// 확정 라벨 설명 라인 (총괄 confirm).
const RELABEL_LINE = '급여 항목의 환자 부담분은 「본인부담금」으로 표기됩니다';
const DOC_KEYS = ['bill_detail', 'bill_receipt', 'bill_receipt_new'] as const;

const svc = (over: Partial<BillingService> & { id: string; name: string }): BillingService => ({
  service_code: null, hira_code: null, vat_type: 'none',
  is_insurance_covered: false, category_label: null, price: 0, ...over,
});

// 급여(재진진찰료 AA254 13,370 covered) + 비급여(레이저 350,000) 혼합 방문.
const MIXED_VISIT: FootBillingItem[] = [
  { service: svc({ id: 'c1', name: '재진진찰료-의원', service_code: 'AA254', hira_code: 'AA254', is_insurance_covered: true, category_label: '기본', price: 13370 }), qty: 1, unitPrice: 13370 },
  { service: svc({ id: 's1', name: '가열성 진균증 레이저 치료', service_code: 'SZ035', is_insurance_covered: false, category_label: '풋케어', price: 350000 }), qty: 1, unitPrice: 350000 },
];

const won = (n: number) => n.toLocaleString('ko-KR');

/** GONGDAN-SUM-REGRESSION 스펙과 동일한 바인딩 절차 replay (라벨 무관 — 산식 회귀 역가드용). */
function bindDocs(items: FootBillingItem[], grade: 'general' | null) {
  const fb = computeFootBilling(items, grade);
  const copaymentTotal = fb.copaymentTotal;
  const nonCovered = fb.nonCoveredTotal;
  const coveredTotal = fb.liveBillingValues.copayment + fb.liveBillingValues.insuranceCovered;
  const grandTotal = fb.grandTotal;

  const values: Record<string, string> = {};
  applyBillingFallback(values, {
    insuranceCovered: Math.max(0, coveredTotal - copaymentTotal),
    copayment: copaymentTotal,
    nonCovered,
    total: grandTotal,
  });
  const detailItems = buildFootBillDetailItems(fb.pricingItems, '2026-07-21', {
    insuranceGrade: grade,
    copaymentTotal,
  });
  values.items_html = buildBillDetailItemsHtml(detailItems);
  values.fee_grid_html = buildBillReceiptFeeGridHtml(detailItems);
  if (grandTotal > 0) {
    values.total_amount = formatAmount(grandTotal);
    values.subtotal_amount = formatAmount(grandTotal);
  }
  values.subtotal_copayment = formatAmount(copaymentTotal);
  values.total_copayment = values.subtotal_copayment;
  values.subtotal_fund = formatAmount(fb.liveBillingValues.insuranceCovered);
  values.total_fund = values.subtotal_fund;
  values.subtotal_noncovered = won(nonCovered);
  values.total_noncovered = won(nonCovered);
  const payable = copaymentTotal + nonCovered;
  const { adjustment, roundedTotal } = computeBillDetailRounding(payable);
  values.detail_subtotal = formatAmount(payable);
  values.detail_rounding = formatAmount(adjustment);
  values.detail_total = formatAmount(roundedTotal);
  values.receipt_total = formatAmount(payable);
  // 신양식(별지 제6호) 환자부담/공단부담 총계 (canon-guard 대상 — 값 자체는 무변경).
  values.patient_amount = formatAmount(payable);
  values.insurance_covered = formatAmount(fb.liveBillingValues.insuranceCovered);
  return { fb, values };
}

// ── canon-guard: 라벨 설명 라인이 템플릿 정적 텍스트로 존재 (숫자 placeholder 아님) ──
test('canon-guard: 3종 템플릿에 확정 라벨 「본인부담금」 설명 라인이 정적 텍스트로 존재', () => {
  for (const key of DOC_KEYS) {
    const tpl = getHtmlTemplate(key);
    expect(tpl, `${key} 템플릿 부재`).toBeTruthy();
    expect(tpl!, `${key}: 확정 라벨 설명 라인 누락`).toContain(RELABEL_LINE);
    // 신규 숫자 placeholder 를 라벨 라인이 끼워넣지 않음(라벨=순수 텍스트, 숫자 무변경 BINDING②).
    const i = tpl!.indexOf(RELABEL_LINE);
    const around = tpl!.slice(i - 80, i + 80);
    expect(around, `${key}: 라벨 라인 인접에 숫자 placeholder 유입`).not.toMatch(/\{\{[^}]*\}\}/);
  }
});

// ── canon-guard: 법정 그리드 필수 칸명 헤더 불변 ──
test('canon-guard: 법정 그리드 칸명(본인부담금/공단부담금/전액본인부담) 헤더 불변', () => {
  const detailTpl = getHtmlTemplate('bill_detail')!;
  const newTpl = getHtmlTemplate('bill_receipt_new')!;
  // 세부산정내역 급여 그리드 super-header + 부담금 칸.
  expect(detailTpl).toContain('<th>본인부담금</th>');
  expect(detailTpl).toContain('<th>공단부담금</th>');
  expect(detailTpl).toContain('전액');
  // 별지 제6호 ⑦ 공단부담 총액 칸 canon(§2-2-6 v1.14) — insurance_covered 바인딩 유지.
  expect(newTpl).toContain('⑦ 공단부담 총액');
  expect(newTpl).toContain('{{insurance_covered}}');
});

for (const [label, items, grade] of [
  ['시나리오1: MIXED-general', MIXED_VISIT, 'general'],
  ['시나리오2: MIXED-null(등급 미확정)', MIXED_VISIT, null],
] as const) {
  test(`${label} — 서류 3종 확정 라벨 노출 + 공단값 canon + 합계 무변경`, async ({ page }) => {
    const { fb, values } = bindDocs(items as FootBillingItem[], grade as 'general' | null);

    const detailHtml = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, values);
    const receiptHtml = bindHtmlTemplate(getHtmlTemplate('bill_receipt')!, values);
    const newHtml = bindHtmlTemplate(getHtmlTemplate('bill_receipt_new')!, values);

    // 확정 라벨이 렌더된 3종 서류에 모두 노출.
    for (const [name, html] of [['detail', detailHtml], ['receipt', receiptHtml], ['receipt_new', newHtml]] as const) {
      expect(html, `${name}: 확정 라벨 미노출`).toContain(RELABEL_LINE);
    }

    // 공단부담금 칸 표시 유지 (canon) — grade=null 이면 공단=0.
    const gongdan = fb.liveBillingValues.insuranceCovered;
    if (grade === null) {
      expect(gongdan, 'grade=null 공단부담금은 0 (canon: 공단=0)').toBe(0);
    }

    // 합계(환자 부담 = 본인부담금 + 비급여, 공단 제외) — 라벨 추가로 산식 무변경.
    const payable = fb.copaymentTotal + fb.nonCoveredTotal;
    const { roundedTotal } = computeBillDetailRounding(payable);
    expect(values.detail_total).toBe(won(roundedTotal));
    expect(values.receipt_total).toBe(won(payable));
    expect(detailHtml).toContain(`<strong>${won(roundedTotal)}</strong>`);
    expect(receiptHtml).toContain(`₩ ${won(payable)}`);

    // 실 브라우저 인쇄 미리보기 — 라벨 라인 가시성 확인(신양식, portrait).
    await page.emulateMedia({ media: 'print' });
    await page.setContent(`<div style="width:760px;padding:16px;">${newHtml}</div>`);
    await expect(page.locator(`text=${RELABEL_LINE}`).first()).toBeVisible();
  });
}
