/**
 * Visual Regression #10 — 통계 페이지
 *
 * 인증 필요. 방문 추이 차트, 매출 차트, 요약 카드 레이아웃.
 *
 * - 기간 선택 영역
 * - 방문 추이 바 차트
 * - 매출 라인 차트
 * - 요약 통계 카드
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('VIS-10 Stats page', () => {
  test('통계 차트 전체 레이아웃', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard 로드 실패');

    await page.getByRole('link', { name: '통계' }).first().click();
    await page.waitForTimeout(3_000); // 차트 렌더링 대기

    // recharts SVG 또는 카드 확인
    const hasChart = await page.locator('.recharts-wrapper, svg.recharts-surface').first().isVisible().catch(() => false);
    const hasCards = await page.locator('[class*="CardHeader"]').first().isVisible().catch(() => false);

    if (!hasChart && !hasCards) {
      await page.waitForTimeout(3_000);
    }

    await expect(page).toHaveScreenshot('stats-overview.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.05, // 차트는 데이터 의존이라 약간 여유
      // 차트 내부 값은 데이터 의존 → SVG 내부 text 마스킹
      mask: [
        page.locator('.recharts-cartesian-axis-tick-value'),
        page.locator('.recharts-tooltip-wrapper'),
      ],
    });
  });
});
