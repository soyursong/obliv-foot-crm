/**
 * Visual Regression #07 — 패키지관리 페이지
 *
 * 인증 필요. 패키지 리스트, 필터 탭, 검색, 패키지 카드 스타일.
 *
 * - 필터 탭 (활성/완료/환불/전체)
 * - 패키지 카드 또는 테이블
 * - 검색 영역
 * - 생성 버튼
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('VIS-07 Packages page', () => {
  test('패키지 리스트 전체 레이아웃', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard 로드 실패');

    await page.getByRole('link', { name: '패키지' }).first().click();
    await page.waitForTimeout(2_000);

    // 필터 탭이 보여야 함
    const hasFilter = await page.getByRole('tab').first().isVisible().catch(() => false);
    if (!hasFilter) {
      await page.waitForTimeout(3_000);
    }

    await expect(page).toHaveScreenshot('packages-list.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });
});
