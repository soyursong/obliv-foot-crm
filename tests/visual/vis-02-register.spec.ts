/**
 * Visual Regression #02 — 회원가입 페이지
 *
 * 공개 페이지(인증 불요). 가입 폼 레이아웃이 변경되면 잡아낸다.
 */
import { test, expect } from '@playwright/test';

test.describe('VIS-02 Register page', () => {
  test('회원가입 페이지 전체 레이아웃', async ({ page }) => {
    await page.goto('/register');
    await expect(
      page.getByRole('button', { name: /가입|등록|회원가입/i }),
    ).toBeVisible({ timeout: 5_000 });

    await expect(page).toHaveScreenshot('register-full.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });
});
