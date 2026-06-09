/**
 * E2E spec — T-20260609-foot-DOCFORM-3FIX-BINDING-DISABLE
 * 풋센터 서류 3종 수정 — 렌더 레벨 검증.
 *
 * 검증 전략: 발행 서류는 순수 HTML 템플릿(`htmlFormTemplates.ts`) + `bindHtmlTemplate`
 *   파이프라인으로 생성된다. DB/auth 없이 실제 브라우저 렌더(page.setContent)로
 *   "현장이 보는 출력물"을 검증한다. 빌더 로직(footBilling)은 단위 검증.
 *
 * 이슈1 [버그] AC-1/2: 진료비 세부산정내역서 본인부담금/공단부담금 per-item 표기.
 *   computeFootBilling 의 집계 copaymentTotal 을 per-item 으로 비례 배분 →
 *   서류 컬럼 합계가 copaymentTotal 과 정확히 일치(진료비계산서 {{copayment}} 정합).
 * 이슈2 AC-3: 통원확인서 비활성 항목("상병 표시 비활성화"/"향후치료의견 미표시") 인쇄 비노출.
 * 이슈3 AC-4: 진료확인서 비활성 항목("상병 표시"/"비활성화") 인쇄 비노출.
 * AC-5(회귀): 비활성 항목 placeholder 화 후에도 도장(원부대조필)·환자명 레이아웃 유지(8FIX 회귀 금지).
 * +재활성화: placeholder 에 값 바인딩 시 정상 재출력(양방향 동작) — "완전 제거 아님" 보존.
 *
 * 회귀 출처: T-20260601-foot-DOC-PRINT-8FIX(진료/통원확인서 레이아웃·도장),
 *           T-20260606-foot-DOC-FIELD-MISSING-3(바인딩 누락 패턴).
 */
import { test, expect } from '@playwright/test';
import {
  getHtmlTemplate,
  bindHtmlTemplate,
  buildBillDetailItemsHtml,
} from '../../src/lib/htmlFormTemplates';
import {
  computeFootBilling,
  buildFootBillDetailItems,
  type BillingService,
  type FootBillingItem,
} from '../../src/lib/footBilling';

/** 템플릿을 바인딩해 한 페이지로 렌더 후 본문 텍스트 반환 */
async function renderBound(
  page: import('@playwright/test').Page,
  formKey: string,
  values: Record<string, string>,
): Promise<string> {
  const tpl = getHtmlTemplate(formKey);
  expect(tpl, `${formKey} 템플릿 존재`).toBeTruthy();
  const html = bindHtmlTemplate(tpl as string, values);
  await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`);
  return (await page.locator('body').innerText()).replace(/ /g, ' ');
}

const svc = (over: Partial<BillingService>): BillingService => ({
  id: over.id ?? 'svc',
  name: over.name ?? '서비스',
  ...over,
});

test.describe('T-20260609-foot-DOCFORM-3FIX — 서류 3종 수정', () => {
  // ───────────────────────── 이슈1 [버그] ─────────────────────────
  test('AC-1: 급여 항목 per-item 본인부담금/공단부담금이 산출된다 (공란 아님)', () => {
    const items: FootBillingItem[] = [
      { service: svc({ id: 's1', name: '도수치료', is_insurance_covered: true }), qty: 1, unitPrice: 30000 },
      { service: svc({ id: 's2', name: '물리치료', is_insurance_covered: true }), qty: 1, unitPrice: 20000 },
    ];
    const fb = computeFootBilling(items, 'general');
    expect(fb.copaymentTotal, '집계 본인부담금 산출됨(데이터 존재)').toBeGreaterThan(0);

    const billItems = buildFootBillDetailItems(items, '2026-06-09', {
      insuranceGrade: 'general',
      copaymentTotal: fb.copaymentTotal,
    });
    // 급여 항목 모두 copayment_amount 가 채워짐 (undefined/누락 금지)
    for (const bi of billItems) {
      expect(bi.is_insurance_covered).toBe(true);
      expect(bi.copayment_amount, '본인부담금 per-item 주입됨').not.toBeUndefined();
    }
  });

  test('AC-2: per-item 본인부담금 합계 = 집계 copaymentTotal (진료비계산서 정합)', () => {
    const items: FootBillingItem[] = [
      { service: svc({ id: 's1', name: '도수치료', is_insurance_covered: true }), qty: 2, unitPrice: 13710 },
      { service: svc({ id: 's2', name: '물리치료', is_insurance_covered: true }), qty: 1, unitPrice: 2548 },
      { service: svc({ id: 's3', name: '비급여시술', is_insurance_covered: false }), qty: 1, unitPrice: 80000 },
    ];
    const fb = computeFootBilling(items, 'general');
    const billItems = buildFootBillDetailItems(items, '2026-06-09', {
      insuranceGrade: 'general',
      copaymentTotal: fb.copaymentTotal,
    });

    const copaySum = billItems.reduce((s, b) => s + (b.copayment_amount ?? 0), 0);
    expect(copaySum, '본인부담금 per-item 합 = 집계 copaymentTotal').toBe(fb.copaymentTotal);

    // 공단부담금(=급여 총액 - 본인부담금) 합도 정합
    const coveredSum = billItems
      .filter((b) => b.is_insurance_covered)
      .reduce((s, b) => s + b.amount * b.count * b.days, 0);
    const fundSum = coveredSum - copaySum;
    expect(fundSum).toBe(fb.coveredTotal - fb.copaymentTotal);
    // 비급여 항목은 본인/공단 미주입
    const nonCov = billItems.find((b) => !b.is_insurance_covered);
    expect(nonCov?.copayment_amount).toBeUndefined();
  });

  test('AC-1: 세부산정내역서 출력물에 본인부담금/공단부담금 금액이 렌더된다', async ({ page }) => {
    const items: FootBillingItem[] = [
      { service: svc({ id: 's1', name: '도수치료', is_insurance_covered: true }), qty: 1, unitPrice: 30000 },
    ];
    const fb = computeFootBilling(items, 'general');
    const billItems = buildFootBillDetailItems(items, '2026-06-09', {
      insuranceGrade: 'general',
      copaymentTotal: fb.copaymentTotal,
    });
    const copay = billItems[0].copayment_amount as number;
    const fund = 30000 - copay;

    const body = await renderBound(page, 'bill_detail', {
      patient_name: '김인은',
      items_html: buildBillDetailItemsHtml(billItems),
      total_amount: '30,000',
      subtotal_amount: '30,000',
    });
    expect(body).toContain('본인부담금');
    expect(body).toContain('공단부담금');
    // 실제 금액이 공란이 아니라 찍힘
    expect(body).toContain(copay.toLocaleString('ko-KR'));
    expect(body).toContain(fund.toLocaleString('ko-KR'));
  });

  test('AC-회귀: copayInfo 미전달 시 기존 동작 보존 (per-item copay 미주입)', () => {
    const items: FootBillingItem[] = [
      { service: svc({ id: 's1', name: '도수치료', is_insurance_covered: true }), qty: 1, unitPrice: 30000 },
    ];
    const billItems = buildFootBillDetailItems(items, '2026-06-09'); // copayInfo 없음
    expect(billItems[0].copayment_amount).toBeUndefined();
  });

  // ───────────────────────── 이슈2 통원확인서 ─────────────────────────
  test('AC-3: 통원확인서 비활성 항목("비활성화"/"미표시")이 출력물에 노출되지 않는다', async ({ page }) => {
    const body = await renderBound(page, 'visit_confirm', {
      patient_name: '김인은',
      record_no: 'F-1130',
      // visit_display_note 미바인딩 = 비활성 → 공란
    });
    expect(body).not.toContain('비활성화');
    expect(body).not.toContain('미표시');
    // 레이아웃 보존 (AC-5): 환자명·도장 정상
    expect(body).toContain('김인은');
    expect(body).toContain('원부대조필');
    expect(body).toContain('통 원 확 인 서');
  });

  test('재활성화(이슈2): visit_display_note 바인딩 시 정상 재출력 (완전 제거 아님)', async ({ page }) => {
    const body = await renderBound(page, 'visit_confirm', {
      patient_name: '김인은',
      visit_display_note: '☑ 상병 표시 활성',
    });
    expect(body).toContain('상병 표시 활성');
  });

  // ───────────────────────── 이슈3 진료확인서 ─────────────────────────
  test('AC-4: 진료확인서 비활성 항목("비활성화")이 출력물에 노출되지 않는다', async ({ page }) => {
    const body = await renderBound(page, 'treat_confirm', {
      patient_name: '이애남',
      record_no: 'F-1130',
      // disease_display_note 미바인딩 = 비활성 → 공란
    });
    expect(body).not.toContain('비활성화');
    // 레이아웃 보존 (AC-5): 환자명·도장 정상
    expect(body).toContain('이애남');
    expect(body).toContain('원부대조필');
    expect(body).toContain('진 료 확 인 서');
  });

  test('재활성화(이슈3): disease_display_note 바인딩 시 정상 재출력 (완전 제거 아님)', async ({ page }) => {
    const body = await renderBound(page, 'treat_confirm', {
      patient_name: '이애남',
      disease_display_note: '☑ 상병 표시 활성',
    });
    expect(body).toContain('상병 표시 활성');
  });
});
