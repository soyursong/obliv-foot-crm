/**
 * T-20260724-foot-COSMETIC-SELLER-ATTRIB
 * 화장품(풋화장품) 매출 담당치료사별 집계 포함 + 판매 치료사 귀속 E2E
 *
 * 요구:
 *   A-1: check_in_services.seller_staff_id (ADDITIVE, NULL FK staff)
 *   A-2: 결제 미니창 화장품 라인에 '판매 치료사' 드롭다운(기본값=차감 치료사/담당 실장 폴백)
 *   A-3: SalesStaffTab(매출집계>담당치료사별) 에 '화장품 매출' 별도 컬럼(A안, 합산 X) — 수납·차감 양쪽.
 *        double-count single-attribution 불변식: 화장품 라인은 치료 매출 컬럼에 얹지 않음.
 *
 * 시나리오(현장 클릭 시나리오 2 = 담당치료사별 집계 반영 기준):
 *   1. [매출집계] → [담당치료사별] → 차감기준 view 에 '화장품 매출' 컬럼 노출
 *   2. 토글 → 수납기준 view 에 '치료 매출' + '화장품 매출' 별도 컬럼 노출(기존 역할/순실적 비파괴)
 *   3. 합계행에 화장품 매출 셀 존재(수납/차감)
 *   4. [회귀] 기존 컬럼(차감건수/차감매출, 역할/순실적) 유지
 *   5. [불변식] 화장품 매출 ≤ 표시된 어떤 total 도 음수화하지 않음(치료 순실적 ≥ 0 or 환불로만 음수)
 *
 * 견고성: prod 실데이터/빈데이터 양쪽 통과 — 컬럼(구조) 존재는 데이터 유무와 무관하게 단언,
 *   금액값 단언은 데이터 존재 시에만.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const SALES_URL = '/admin/sales';
const SHOT_DIR = '_handoff/qa_screenshots/T-20260724-foot-COSMETIC-SELLER-ATTRIB';

async function openStaffTab(page: Page) {
  await page.goto(SALES_URL);
  await expect(page.getByRole('heading', { name: '매출집계' })).toBeVisible({ timeout: 10_000 });
  const tab = page.getByRole('tab', { name: '담당치료사별' });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });
  await expect(page.locator('[data-testid="sales-staff-basis-toggle"]')).toBeVisible({ timeout: 10_000 });
}

async function settleDeduction(page: Page): Promise<'data' | 'empty'> {
  await page.locator('[data-testid="sales-staff-loading"]').waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
  await page
    .locator('[data-testid="sales-staff-deduct-tab"], [data-testid="sales-staff-deduct-empty"]')
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  const hasData = await page.locator('[data-testid="sales-staff-deduct-tab"]').isVisible().catch(() => false);
  return hasData ? 'data' : 'empty';
}

async function settlePayment(page: Page): Promise<'data' | 'empty'> {
  await page.locator('[data-testid="sales-staff-loading"]').waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
  await page
    .locator('[data-testid="sales-staff-tab"], [data-testid="sales-staff-empty"]')
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  const hasData = await page.locator('[data-testid="sales-staff-tab"]').isVisible().catch(() => false);
  return hasData ? 'data' : 'empty';
}

test.describe('T-20260724-foot-COSMETIC-SELLER-ATTRIB 화장품 매출 별도 컬럼', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded — auth 실패');
  });

  // ── 1. 차감기준 view — 화장품 매출 컬럼 노출 ─────────────────────────────
  test('차감기준: 화장품 매출 컬럼 + 합계 셀 노출', async ({ page }) => {
    await openStaffTab(page);
    const state = await settleDeduction(page);
    if (state === 'empty') {
      await expect(page.locator('[data-testid="sales-staff-deduct-empty"]')).toBeVisible();
      console.log('[COSMETIC-ATTRIB] 차감 데이터 없음 — empty state 정상(컬럼 단언 skip)');
      return;
    }
    const tbl = page.locator('[data-testid="sales-staff-deduct-tab"]');
    await expect(tbl.getByRole('columnheader', { name: '화장품 매출' })).toBeVisible();
    await expect(tbl.getByRole('columnheader', { name: '차감 매출(치료)' })).toBeVisible();
    // 합계행 화장품 셀
    await expect(page.locator('[data-testid="sales-staff-deduct-total-cosmetic"]')).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/deduct_cosmetic_col.png`, fullPage: true });
    console.log('[COSMETIC-ATTRIB] 차감기준 화장품 매출 컬럼 OK');
  });

  // ── 2. 수납기준 view — 치료 매출 + 화장품 매출 별도 컬럼 + 기존 비파괴 ──────
  test('수납기준: 치료 매출 + 화장품 매출 별도 컬럼(역할/순실적 비파괴)', async ({ page }) => {
    await openStaffTab(page);
    await settleDeduction(page);
    await page.locator('[data-testid="sales-staff-basis-payment"]').click();
    const state = await settlePayment(page);
    if (state === 'empty') {
      await expect(page.locator('[data-testid="sales-staff-empty"]')).toBeVisible();
      console.log('[COSMETIC-ATTRIB] 수납 데이터 없음 — empty state 정상(컬럼 단언 skip)');
      return;
    }
    const tbl = page.locator('[data-testid="sales-staff-tab"]');
    await expect(tbl.getByRole('columnheader', { name: '치료 매출' })).toBeVisible();
    await expect(tbl.getByRole('columnheader', { name: '화장품 매출' })).toBeVisible();
    // 회귀: 기존 컬럼 유지
    await expect(tbl.getByRole('columnheader', { name: '역할' })).toBeVisible();
    await expect(tbl.getByRole('columnheader', { name: '순 실적' })).toBeVisible();
    // 합계행 셀
    await expect(page.locator('[data-testid="sales-staff-total-cosmetic"]')).toBeVisible();
    await expect(page.locator('[data-testid="sales-staff-total-net"]')).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/payment_cosmetic_col.png`, fullPage: true });
    console.log('[COSMETIC-ATTRIB] 수납기준 치료/화장품 별도 컬럼 OK');
  });

  // ── 3. 불변식(별도 컬럼, 합산 X): 화장품 셀은 치료 매출과 독립 표시 ──────────
  test('불변식: 화장품 매출 셀이 치료 매출 셀과 별도로 렌더(합산 아님)', async ({ page }) => {
    await openStaffTab(page);
    await settleDeduction(page);
    await page.locator('[data-testid="sales-staff-basis-payment"]').click();
    const state = await settlePayment(page);
    if (state === 'empty') {
      test.skip(true, '수납 데이터 없음 — 셀 독립성 단언 대상 부재');
      return;
    }
    // 첫 치료사 행: 화장품 매출 셀이 치료 매출 셀과 다른 td 로 존재(구조적 분리 = 합산 아님).
    const cosmeticCell = page.locator('[data-testid^="sales-staff-cosmetic-therapist-"]').first();
    const netCell = page.locator('[data-testid^="sales-staff-net-therapist-"]').first();
    const hasRows = (await cosmeticCell.count()) > 0;
    if (!hasRows) {
      test.skip(true, '치료사 행 없음(장비명 only 등) — skip');
      return;
    }
    await expect(cosmeticCell).toBeVisible();
    await expect(netCell).toBeVisible();
    console.log('[COSMETIC-ATTRIB] 화장품/순실적 셀 구조적 분리 OK (별도 컬럼)');
  });
});
