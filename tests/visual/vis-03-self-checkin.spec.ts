/**
 * Visual Regression #03 — 셀프체크인 키오스크 페이지
 *
 * 공개 페이지(인증 불요). 태블릿 터치 UX가 핵심이므로
 * 768x1024 뷰포트에서도 검증한다.
 *
 * - 이름/전화번호 입력 영역
 * - 온스크린 숫자패드
 * - 방문유형 선택 버튼
 */
import { test, expect } from '@playwright/test';

test.describe('VIS-03 Self check-in kiosk', () => {
  test('체크인 초기 화면 (desktop)', async ({ page }) => {
    await page.goto('/checkin/jongno-foot');

    // 클리닉 못 찾는 경우 대비 — 입력 폼 또는 에러 메시지 중 하나
    const hasInput = await page.getByPlaceholder(/이름|성함/).isVisible().catch(() => false);
    const hasError = await page.getByText(/클리닉|찾을 수 없/).isVisible().catch(() => false);

    if (!hasInput && !hasError) {
      // 로딩 중일 수 있으므로 잠시 대기
      await page.waitForTimeout(3_000);
    }

    await expect(page).toHaveScreenshot('self-checkin-initial.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });

  test('체크인 초기 화면 (tablet 768x1024)', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/checkin/jongno-foot');
    await page.waitForTimeout(2_000);

    await expect(page).toHaveScreenshot('self-checkin-tablet.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });
});
