/**
 * Visual Regression #06 — 고객관리 페이지
 *
 * 인증 필요. 고객 테이블/리스트 레이아웃, 검색 바, 탭 구성 확인.
 *
 * - 검색 입력 영역
 * - 고객 리스트 테이블 헤더
 * - 탭 (전체/신환/재진 등)
 * - 등록 버튼
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('VIS-06 Customers page', () => {
  test('고객관리 전체 레이아웃', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard 로드 실패');

    await page.getByRole('link', { name: '고객관리' }).first().click();
    await page.waitForTimeout(2_000);

    // 검색 영역 또는 고객 리스트 확인
    const hasSearch = await page.getByPlaceholder(/검색|이름|전화/).first().isVisible().catch(() => false);
    const hasTable = await page.locator('table, [role="grid"]').first().isVisible().catch(() => false);
    if (!hasSearch && !hasTable) {
      await page.waitForTimeout(3_000);
    }

    await expect(page).toHaveScreenshot('customers-list.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });
});
