/**
 * T-20260605-foot-SALES-STAFF-DEDUCT-BASIS
 * 매출집계 탭5 — 담당직원별 귀속 기준 전환(수납 → 패키지 차감) E2E
 *
 * 시나리오:
 *   1. [매출집계] → [담당직원별] 탭 → 귀속 기준 토글 렌더 (기본 차감기준)
 *   2. 차감기준 view: 치료사·차감건수·차감매출 컬럼 + 합계행 (또는 empty)
 *   3. 토글 → 수납기준 view 전환: 기존 직원별 테이블(역할/순실적) 유지 비파괴
 *   4. 토글 → 차감기준 복귀
 *   5. 기간 프리셋(이번달) 후에도 토글/탭 유지
 *   6. 검색 필터: 없는 이름 → 0행/empty
 *
 * 빈 데이터(staging)에서는 empty state 검증으로 대체.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const SALES_URL = '/admin/sales';

async function openStaffTab(page: import('@playwright/test').Page) {
  await page.goto(SALES_URL);
  await expect(page.getByText('매출집계')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('tab', { name: '담당치료사별' }).click();
}

test.describe('T-20260605-foot-SALES-STAFF-DEDUCT-BASIS 담당직원별 차감기준 전환', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded — auth 실패');
  });

  // ── 1. 귀속 기준 토글 렌더 (기본 차감기준) ──────────────────────────────
  test('담당직원별 탭 → 귀속 기준 토글 렌더 + 기본값 차감기준', async ({ page }) => {
    await openStaffTab(page);

    const toggle = page.locator('[data-testid="sales-staff-basis-toggle"]');
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="sales-staff-basis-deduction"]')).toBeVisible();
    await expect(page.locator('[data-testid="sales-staff-basis-payment"]')).toBeVisible();

    // 기본값: 차감기준 view 또는 차감 empty 중 하나
    const hasDeduct = await page.locator('[data-testid="sales-staff-deduct-tab"]').isVisible().catch(() => false);
    const hasDeductEmpty = await page.locator('[data-testid="sales-staff-deduct-empty"]').isVisible().catch(() => false);
    expect(hasDeduct || hasDeductEmpty).toBe(true);
    console.log(`[DEDUCT-BASIS] 토글 렌더 OK — deductTab:${hasDeduct} empty:${hasDeductEmpty}`);
  });

  // ── 2. 차감기준 view 컬럼/합계 ──────────────────────────────────────────
  test('차감기준 view: 치료사·차감건수·차감매출 컬럼 + 합계행', async ({ page }) => {
    await openStaffTab(page);

    const hasDeduct = await page
      .locator('[data-testid="sales-staff-deduct-tab"]')
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    if (!hasDeduct) {
      await expect(page.locator('[data-testid="sales-staff-deduct-empty"]')).toBeVisible();
      console.log('[DEDUCT-BASIS] 차감 데이터 없음 — empty state 정상');
      return;
    }

    const tbl = page.locator('[data-testid="sales-staff-deduct-tab"]');
    await expect(tbl.getByText('치료사')).toBeVisible();
    await expect(tbl.getByText('차감 건수')).toBeVisible();
    await expect(tbl.getByText('차감 매출')).toBeVisible();
    await expect(page.locator('[data-testid="sales-staff-deduct-total-count"]')).toBeVisible();
    await expect(page.locator('[data-testid="sales-staff-deduct-total-revenue"]')).toBeVisible();
    console.log('[DEDUCT-BASIS] 차감기준 컬럼/합계 OK');
  });

  // ── 3. 수납기준 view 전환 — 기존 비파괴 ─────────────────────────────────
  test('수납기준 토글 → 기존 직원별 테이블(역할/순실적) 유지', async ({ page }) => {
    await openStaffTab(page);

    await page.locator('[data-testid="sales-staff-basis-payment"]').click();
    await page.waitForTimeout(800);

    const hasPay = await page.locator('[data-testid="sales-staff-tab"]').isVisible().catch(() => false);
    const hasPayEmpty = await page.locator('[data-testid="sales-staff-empty"]').isVisible().catch(() => false);
    expect(hasPay || hasPayEmpty).toBe(true);

    if (hasPay) {
      const tbl = page.locator('[data-testid="sales-staff-tab"]');
      await expect(tbl.getByText('역할')).toBeVisible();
      await expect(tbl.getByText('순 실적')).toBeVisible();
      await expect(page.locator('[data-testid="sales-staff-total-net"]')).toBeVisible();
    }
    console.log(`[DEDUCT-BASIS] 수납기준 비파괴 OK — payTab:${hasPay} empty:${hasPayEmpty}`);
  });

  // ── 4. 차감기준 복귀 ────────────────────────────────────────────────────
  test('수납 → 차감 토글 복귀 정상', async ({ page }) => {
    await openStaffTab(page);

    await page.locator('[data-testid="sales-staff-basis-payment"]').click();
    await page.waitForTimeout(500);
    await page.locator('[data-testid="sales-staff-basis-deduction"]').click();
    await page.waitForTimeout(500);

    const hasDeduct = await page.locator('[data-testid="sales-staff-deduct-tab"]').isVisible().catch(() => false);
    const hasDeductEmpty = await page.locator('[data-testid="sales-staff-deduct-empty"]').isVisible().catch(() => false);
    expect(hasDeduct || hasDeductEmpty).toBe(true);
    console.log('[DEDUCT-BASIS] 차감기준 복귀 OK');
  });

  // ── 5. 기간 프리셋 후에도 탭/토글 유지 ──────────────────────────────────
  test('프리셋(이번달) 후 탭/토글 유지 + 렌더', async ({ page }) => {
    await openStaffTab(page);

    await page.locator('[data-testid="sales-preset-month"]').click();
    await page.waitForTimeout(1_200);

    const staffTab = page.getByRole('tab', { name: '담당치료사별' });
    await expect(staffTab).toHaveAttribute('data-state', 'active');
    await expect(page.locator('[data-testid="sales-staff-basis-toggle"]')).toBeVisible();
    console.log('[DEDUCT-BASIS] 프리셋 후 토글 유지 OK');
  });

  // ── 6. 검색 필터 — 없는 이름 ────────────────────────────────────────────
  test('검색바 없는 이름 → 차감기준 0행/empty', async ({ page }) => {
    await openStaffTab(page);

    const searchInput = page.locator('[data-testid="sales-search"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('존재하지않는치료사XXXXXXX');
    await page.waitForTimeout(500);

    const hasEmpty = await page.locator('[data-testid="sales-staff-deduct-empty"]').isVisible().catch(() => false);
    const hasTable = await page.locator('[data-testid="sales-staff-deduct-tab"]').isVisible().catch(() => false);

    if (hasTable) {
      const rows = await page.locator('[data-testid^="sales-staff-deduct-row-"]').count();
      expect(rows).toBe(0);
    } else {
      expect(hasEmpty).toBe(true);
    }

    await searchInput.fill('');
    console.log('[DEDUCT-BASIS] 검색 필터 OK');
  });
});
