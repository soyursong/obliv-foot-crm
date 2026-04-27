/**
 * Visual Regression #01 — 로그인 페이지
 *
 * 공개 페이지(인증 불요). 로그인 폼 레이아웃이 변경되면 잡아낸다.
 * - 로고/타이틀 영역
 * - 이메일·비밀번호 필드
 * - 로그인 버튼
 * - 회원가입 링크
 */
import { test, expect } from '@playwright/test';

test.describe('VIS-01 Login page', () => {
  test('로그인 페이지 전체 레이아웃', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('오블리브 풋센터')).toBeVisible();
    await expect(page.getByLabel('이메일')).toBeVisible();
    await expect(page.getByLabel('비밀번호')).toBeVisible();
    await expect(page.getByRole('button', { name: '로그인' })).toBeVisible();

    await expect(page).toHaveScreenshot('login-full.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });

  test('로그인 폼 영역 스냅샷', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: '로그인' })).toBeVisible();

    // 폼 영역만 스냅샷 — 배경 변경에 덜 민감
    const form = page.locator('form').first();
    await expect(form).toHaveScreenshot('login-form.png', {
      maxDiffPixelRatio: 0.01,
    });
  });
});
