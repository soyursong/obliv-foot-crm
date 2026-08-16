/**
 * T-20260805-foot-CF-PHISHING-BLOCK-LOGIN — 로그인 경로 rename (/login → /signin)
 *
 * 배경: Cloudflare "Suspected Phishing" 인터스티셜이 pages.dev 공유 서브도메인 연좌로
 *   경로 `/login`(server GET)만 path-exact 하드차단(403). CEO 실측(MSG-20260816-151913).
 *   앱 로그인 canonical 경로를 미차단 경로 `/signin` 으로 rename → 하드리프레시/직접URL/북마크 unblock.
 *
 * 본 spec = 로컬 dev 서버 대상(CF edge 차단 없음) → 라우트 rename 자체의 정합만 검증.
 *   실제 CF 차단 해소 재현은 라이브 브라우저 접속(infra evidence)로 별도 확인.
 *
 * 검증:
 *   1) /signin = canonical 로그인 화면(폼 렌더).
 *   2) /login  = client-side redirect alias → /signin 착지(stray nav 방어, 앱은 /login 으로 안 향함).
 *   3) 미인증 /admin = /signin 리다이렉트(ProtectedRoute).
 */
import { test, expect } from '@playwright/test';

test.describe('T-20260805 CF phishing — login route rename', () => {
  test('/signin 이 로그인 화면(canonical)을 렌더한다', async ({ page }) => {
    await page.goto('/signin');
    await expect(page).toHaveURL(/\/signin$/);
    await expect(page.getByText('오블리브 풋센터')).toBeVisible();
    await expect(page.getByLabel('이메일')).toBeVisible();
    await expect(page.getByLabel('비밀번호')).toBeVisible();
    await expect(page.getByRole('button', { name: '로그인' })).toBeVisible();
  });

  test('/login 은 /signin 으로 client-side redirect 된다(alias)', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/\/signin$/);
    await expect(page.getByRole('button', { name: '로그인' })).toBeVisible();
  });

  test('미인증 /admin 진입은 /signin 으로 튕긴다', async ({ page }) => {
    // 스토리지 상태 없이 진입 → ProtectedRoute 가 /signin 으로 Navigate.
    await page.context().clearCookies();
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/signin$/);
    await expect(page.getByRole('button', { name: '로그인' })).toBeVisible();
  });
});
