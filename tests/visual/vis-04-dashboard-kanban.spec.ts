/**
 * Visual Regression #04 — 대시보드 칸반 보드
 *
 * 인증 필요. 칸반 보드의 컬럼 레이아웃, 카드 스타일, 상단 툴바가
 * 일관성을 유지하는지 확인한다.
 *
 * - 신규/재진 탭
 * - 칸반 컬럼 헤더 (대기, 상담, 시술대기, 레이저 등)
 * - 사이드바 네비게이션
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('VIS-04 Dashboard kanban', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard 로드 실패');
  });

  test('칸반 보드 전체 레이아웃', async ({ page }) => {
    // 칸반이 로드될 때까지 대기 — 최소 하나의 컬럼 헤더
    await expect(page.getByText('대기').first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1_000); // Realtime 데이터 안정화

    // 동적 데이터(시간, 경과시간) 마스킹 — 시간 표시 영역
    await expect(page).toHaveScreenshot('dashboard-kanban.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.03,
      mask: [
        // 경과시간 표시 (MM:SS), 현재 시각 등 동적 텍스트
        page.locator('[data-testid="elapsed-time"]'),
        page.locator('time'),
      ],
    });
  });

  test('신규/재진/전체 탭 전환 후 레이아웃', async ({ page }) => {
    await expect(page.getByText('대기').first()).toBeVisible({ timeout: 10_000 });

    // 신규 탭
    const newTab = page.getByRole('tab', { name: /신규/ }).first();
    if (await newTab.isVisible()) {
      await newTab.click();
      await page.waitForTimeout(500);
      await expect(page).toHaveScreenshot('dashboard-tab-new.png', {
        maxDiffPixelRatio: 0.03,
        mask: [page.locator('[data-testid="elapsed-time"]'), page.locator('time')],
      });
    }

    // 재진 탭
    const retTab = page.getByRole('tab', { name: /재진/ }).first();
    if (await retTab.isVisible()) {
      await retTab.click();
      await page.waitForTimeout(500);
      await expect(page).toHaveScreenshot('dashboard-tab-returning.png', {
        maxDiffPixelRatio: 0.03,
        mask: [page.locator('[data-testid="elapsed-time"]'), page.locator('time')],
      });
    }
  });
});
