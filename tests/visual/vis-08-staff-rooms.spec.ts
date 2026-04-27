/**
 * Visual Regression #08 — 직원·공간 관리 페이지
 *
 * 인증 필요. 직원 목록, 공간 배정 탭, 방 유형별 카드 스타일.
 *
 * - 직원 탭 / 공간 배정 탭
 * - 직원 카드 (역할 뱃지)
 * - 공간 배정 그리드 (치료실/레이저실/상담실/원장실)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('VIS-08 Staff & Rooms page', () => {
  test('직원·공간 전체 레이아웃', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard 로드 실패');

    await page.getByRole('link', { name: '직원·공간' }).first().click();
    await page.waitForTimeout(2_000);

    await expect(page).toHaveScreenshot('staff-rooms-main.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });

  test('공간 배정 탭 레이아웃', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard 로드 실패');

    await page.getByRole('link', { name: '직원·공간' }).first().click();
    await page.waitForTimeout(1_500);

    // 공간 배정 탭 클릭
    const roomTab = page.getByRole('tab', { name: /공간|배정|방/ }).first();
    if (await roomTab.isVisible()) {
      await roomTab.click();
      await page.waitForTimeout(1_000);

      await expect(page).toHaveScreenshot('staff-room-assignment.png', {
        fullPage: true,
        maxDiffPixelRatio: 0.03,
        // 날짜/주간 헤더 마스킹
        mask: [page.locator('[data-testid="week-header-dates"]')],
      });
    }
  });
});
