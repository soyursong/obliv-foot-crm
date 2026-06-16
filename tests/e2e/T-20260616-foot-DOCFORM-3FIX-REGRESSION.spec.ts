/**
 * E2E spec — T-20260616-foot-DOCFORM-3FIX-REGRESSION-BMSEOK
 * 진료비 세부산정내역서 본인/공단 공란 회귀(박민석 케이스) — Path A(service_charges 직결) 보강 검증.
 *
 * 회귀 RC(STEP-0):
 *   - 0cbbdc2(T-20260609-foot-DOCFORM-3FIX) 코드는 현 main 에 전부 잔존(회귀 커밋 없음).
 *   - 0cbbdc2 는 `check_in_services` 폴백 경로(Path B, buildFootBillDetailItems)만 per-item
 *     본인부담금 배분으로 채웠다. `service_charges` 기록 보유 차트는 DocumentPrintPanel 의
 *     Path A(serviceItems 직결, form_key='bill_detail' && serviceItems.length>0)로 빌드되며,
 *     이 경로는 per-item 배분 없이 service_charges.copayment_amount(흔히 null)에만 의존 →
 *     급여 본인/공단 컬럼 '0'/공란 잔존 = 박민석 RC(미커버 경로).
 *   - 해소: fillBillItemCopayment 로 Path A 빌아이템에 동일 비례배분 규칙 적용(무파괴 가드 포함).
 *
 * 검증: 빌더 로직(footBilling.fillBillItemCopayment)은 단위 검증 + 실제 HTML 렌더(page.setContent)로
 *   "현장 출력물"에 금액이 찍히는지 확인. DB/auth 불요.
 *
 * 회귀 가드: AC-2(합계=copaymentTotal 정합), 무파괴(DB 값 보존), 무보험 미개입.
 */
import { test, expect } from '@playwright/test';
import {
  getHtmlTemplate,
  bindHtmlTemplate,
  buildBillDetailItemsHtml,
} from '../../src/lib/htmlFormTemplates';
import { fillBillItemCopayment } from '../../src/lib/footBilling';
import { getBaseCopayRate } from '../../src/lib/insurance';

/** Path A(DocumentPrintPanel serviceItems.map) 와 동일 형태의 bill 아이템 */
type BillItem = {
  category: string;
  date: string;
  code: string;
  name: string;
  amount: number;
  count: number;
  days: number;
  is_insurance_covered: boolean;
  copayment_amount?: number;
};

const billItem = (over: Partial<BillItem>): BillItem => ({
  category: over.is_insurance_covered ? '이학요법료' : '기타',
  date: '2026-06-16',
  code: over.code ?? '',
  name: over.name ?? '항목',
  amount: over.amount ?? 0,
  count: over.count ?? 1,
  days: over.days ?? 1,
  is_insurance_covered: over.is_insurance_covered ?? false,
  copayment_amount: over.copayment_amount,
});

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

test.describe('T-20260616-foot-DOCFORM-3FIX-REGRESSION — Path A 본인/공단 보강', () => {
  // ── AC-1: service_charges 경로 본인부담금 미설정 → 등급기준 배분으로 채워짐(공란 아님) ──
  test('AC-1: copayment 미설정 급여 항목이 등급기준 per-item 본인부담금으로 채워진다', () => {
    const items: BillItem[] = [
      billItem({ name: '도수치료', amount: 30000, is_insurance_covered: true }),
      billItem({ name: '물리치료', amount: 20000, is_insurance_covered: true }),
      billItem({ name: '비급여시술', amount: 80000, is_insurance_covered: false }),
    ];
    fillBillItemCopayment(items, 'general');
    const covered = items.filter((i) => i.is_insurance_covered);
    for (const c of covered) {
      expect(c.copayment_amount, '급여 항목 본인부담금 주입됨(공란 아님)').not.toBeUndefined();
      expect(c.copayment_amount).toBeGreaterThan(0);
    }
    // 비급여 항목은 미주입
    const nonCov = items.find((i) => !i.is_insurance_covered);
    expect(nonCov?.copayment_amount).toBeUndefined();
  });

  // ── AC-2: per-item 본인부담금 합계 = 집계 copaymentTotal (진료비계산서 정합) ──
  test('AC-2: 본인부담금 per-item 합 = 일반등급(30%) 집계 copaymentTotal(100원 절상)', () => {
    const items: BillItem[] = [
      billItem({ name: '도수치료', amount: 13710, count: 2, is_insurance_covered: true }),
      billItem({ name: '물리치료', amount: 2548, is_insurance_covered: true }),
    ];
    fillBillItemCopayment(items, 'general');
    const coveredSum = items
      .filter((i) => i.is_insurance_covered)
      .reduce((s, i) => s + i.amount * i.count * i.days, 0);
    // computeFootBilling 과 동일 공식: ceil(coveredSum*rate/100)*100 (rate=분수, 100원 절상)
    const rate = getBaseCopayRate('general');
    const expectedTotal = Math.min(Math.ceil((coveredSum * rate) / 100) * 100, coveredSum);
    const copaySum = items.reduce((s, i) => s + (i.copayment_amount ?? 0), 0);
    expect(copaySum, '본인부담금 per-item 합 = 집계 copaymentTotal').toBe(expectedTotal);
    // 공단부담금 합 = 급여총액 - 본인부담 합 (음수 없음)
    const fundSum = coveredSum - copaySum;
    expect(fundSum).toBe(coveredSum - expectedTotal);
    expect(fundSum).toBeGreaterThanOrEqual(0);
  });

  // ── 무파괴: DB(service_charges)에 copayment_amount 가 이미 있으면 미개입 ──
  test('무파괴: covered 항목에 copayment_amount 이미 존재 시 기존 값 보존(미개입)', () => {
    const items: BillItem[] = [
      billItem({ name: '도수치료', amount: 30000, is_insurance_covered: true, copayment_amount: 12000 }),
      billItem({ name: '물리치료', amount: 20000, is_insurance_covered: true }),
    ];
    fillBillItemCopayment(items, 'general');
    expect(items[0].copayment_amount, 'DB 값 보존').toBe(12000);
    // 일부라도 존재하면 전체 미개입(혼합 배분 금지) → 두 번째도 그대로 undefined
    expect(items[1].copayment_amount).toBeUndefined();
  });

  // ── 데이터 조건: 무보험(등급 null)·비대상 등급은 분리 불가 → 미개입(기존 동작) ──
  test('데이터 조건: 보험등급 null(무보험)이면 본인/공단 미개입(기존 동작 보존)', () => {
    const items: BillItem[] = [
      billItem({ name: '도수치료', amount: 30000, is_insurance_covered: true }),
    ];
    fillBillItemCopayment(items, null);
    expect(items[0].copayment_amount, '무보험 → 본인부담 분리 안 함').toBeUndefined();
  });

  // ── 의료급여 1종(본인부담 0): 0 명시 → 공단부담금 급여전액 정상 ──
  test('의료급여 1종(본인부담 0%): copayment 0 명시 → 공단부담금=급여전액', () => {
    const items: BillItem[] = [
      billItem({ name: '도수치료', amount: 30000, is_insurance_covered: true }),
    ];
    fillBillItemCopayment(items, 'medical_aid_1');
    expect(items[0].copayment_amount, '본인부담 0 명시(undefined 아님)').toBe(0);
  });

  // ── 렌더: Path A 출력물에 본인/공단 금액이 공란 아닌 실제 금액으로 찍힌다 ──
  test('AC-1(렌더): 세부산정내역서 출력물에 본인/공단 금액이 찍힌다(공란 아님)', async ({ page }) => {
    const items: BillItem[] = [
      billItem({ name: '도수치료', amount: 30000, is_insurance_covered: true }),
    ];
    fillBillItemCopayment(items, 'general');
    const copay = items[0].copayment_amount as number;
    const fund = 30000 - copay;
    expect(copay).toBeGreaterThan(0);

    const body = await renderBound(page, 'bill_detail', {
      patient_name: '박민석',
      items_html: buildBillDetailItemsHtml(items),
      total_amount: '30,000',
      subtotal_amount: '30,000',
    });
    expect(body).toContain('본인부담금');
    expect(body).toContain('공단부담금');
    expect(body).toContain(copay.toLocaleString('ko-KR'));
    expect(body).toContain(fund.toLocaleString('ko-KR'));
  });
});
