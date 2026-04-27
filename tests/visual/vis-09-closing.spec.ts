/**
 * Visual Regression #09 — 일마감 페이지
 *
 * 인증 필요. 매출 요약 카드, 결제 내역 테이블, 미수금 환자 목록.
 *
 * - 날짜 선택 영역
 * - 매출 요약 카드 (카드/현금/이체/합계)
 * - 결제 상세 테이블
 * - 마감/잠금 버튼
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('VIS-09 Closing page', () => {
  test('일마감 전체 레이아웃', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard 로드 실패');

    await page.getByRole('link', { name: '일마감' }).first().click();
    await page.waitForTimeout(2_000);

    // 매출 카드 또는 합계 영역 확인
    const hasCard = await page.locator('[class*="CardHeader"], [class*="card"]').first().isVisible().catch(() => false);
    if (!hasCard) {
      await page.waitForTimeout(3_000);
    }

    await expect(page).toHaveScreenshot('closing-daily.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.03,
      // 날짜, 금액은 매일 바뀌므로 구조만 비교
      mask: [
        page.locator('[data-testid="closing-date"]'),
        page.locator('[data-testid="closing-totals"]'),
      ],
    });
  });
});
