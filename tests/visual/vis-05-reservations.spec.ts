/**
 * Visual Regression #05 — 예약관리 주간 캘린더
 *
 * 인증 필요. 주간 캘린더 그리드, 시간 슬롯, 예약 카드 스타일 확인.
 *
 * - 주간 헤더 (월~일)
 * - 시간 슬롯 그리드
 * - 예약 카드 색상 (신규=blue, 재진=emerald, 체험=amber)
 * - 주 이동 버튼
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('VIS-05 Reservations calendar', () => {
  test('예약관리 주간 캘린더 레이아웃', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard 로드 실패');

    // 사이드바에서 예약관리로 이동
    await page.getByRole('link', { name: '예약관리' }).first().click();
    await page.waitForTimeout(2_000);

    // 주간 캘린더 로드 확인 — 요일 헤더
    const hasDay = await page.getByText(/월|화|수|목|금/).first().isVisible().catch(() => false);
    if (!hasDay) {
      await page.waitForTimeout(3_000);
    }

    await expect(page).toHaveScreenshot('reservations-weekly.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.03,
      // 날짜 텍스트는 매일 바뀌므로 마스킹
      mask: [page.locator('[data-testid="week-header-dates"]')],
    });
  });
});
