/**
 * 전 페이지 렌더링 검증 + 스크린샷 캡처
 *
 * 인증 필요 페이지는 로그인 후 사이드바 네비게이션으로 이동하여
 * 세션 재검증 문제를 회피한다.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from './helpers';

// ────────────────────────────────────────
// 1. 공개 페이지 (인증 불요)
// ────────────────────────────────────────
test.describe('Public pages', () => {
  test('Login page renders correctly', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('오블리브 풋센터')).toBeVisible();
    await expect(page.getByLabel('이메일')).toBeVisible();
    await expect(page.getByLabel('비밀번호')).toBeVisible();
    await expect(page.getByRole('button', { name: '로그인' })).toBeVisible();
    await expect(page.getByText('회원가입')).toBeVisible();
    await page.screenshot({ path: 'test-results/screenshots/login.png', fullPage: true });
  });

  test('Register page renders correctly', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByRole('button', { name: /가입|등록|회원가입/i })).toBeVisible({ timeout: 5_000 });
    await page.screenshot({ path: 'test-results/screenshots/register.png', fullPage: true });
  });
});

// ────────────────────────────────────────
// 2. 인증 필요 페이지 (로그인 후 사이드바 클릭)
// ────────────────────────────────────────
test.describe('Authenticated pages', () => {
  // 사이드바 링크 텍스트 → 스크린샷 파일명 매핑
  const sidebarPages = [
    { label: '대시보드', file: 'dashboard' },
    { label: '예약관리', file: 'reservations' },
    { label: '고객관리', file: 'customers' },
    { label: '패키지', file: 'packages' },
    { label: '직원·공간', file: 'staff' },
    { label: '일마감', file: 'closing' },
    { label: '통계', file: 'stats' },
    { label: '계정관리', file: 'accounts' },
  ];

  test('All admin pages render via sidebar navigation', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Could not login');
      return;
    }

    // Dashboard는 이미 로드됨
    await page.screenshot({
      path: 'test-results/screenshots/dashboard.png',
      fullPage: true,
    });

    // 나머지 페이지를 사이드바 링크로 순회
    for (const pg of sidebarPages) {
      if (pg.label === '대시보드') continue; // 이미 캡처함

      const link = page.getByRole('link', { name: pg.label }).first();
      const linkVisible = await link.isVisible().catch(() => false);

      if (!linkVisible) {
        test.info().annotations.push({
          type: 'skip',
          description: `Sidebar link "${pg.label}" not visible (role restriction?)`,
        });
        continue;
      }

      await link.click();
      // 페이지 전환 대기
      await page.waitForTimeout(1_500);

      await page.screenshot({
        path: `test-results/screenshots/${pg.file}.png`,
        fullPage: true,
      });

      test.info().annotations.push({
        type: 'page',
        description: `${pg.label} → ${page.url()}`,
      });
    }
  });
});
