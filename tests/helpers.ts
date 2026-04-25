/**
 * 테스트 공용 헬퍼
 *
 * 변경 (T-foot-PW04 unblock, 2026-04-25):
 * - storageState 가 정상 주입되면 /admin 직접 진입으로 충분 → UI 로그인 불필요
 * - storageState 없거나 만료 시 UI 로그인 폴백 (rate-limit 위험)
 */
import type { Page } from '@playwright/test';

const TEST_EMAIL = process.env.TEST_EMAIL ?? 'test@medibuilder.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'TestPass2026!';

/**
 * /admin 진입 시 이미 storageState 로 인증된 상태가 정상.
 * Dashboard 텍스트가 보이면 true. /login 으로 튕기면 UI 로그인 폴백.
 */
export async function loginAndWaitForDashboard(page: Page): Promise<boolean> {
  await page.goto('/admin');

  // storageState 로 인증된 케이스 — /admin 그대로 유지
  if (!page.url().includes('/login')) {
    try {
      await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
      await page.waitForTimeout(500);
      return true;
    } catch {
      // 인증은 됐는데 화면 못 그림 — 폴백 시도
    }
  }

  return uiLogin(page);
}

async function uiLogin(page: Page): Promise<boolean> {
  await page.goto('/login');

  if (!page.url().includes('/login')) {
    try {
      await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
      return true;
    } catch {
      return false;
    }
  }

  await page.getByLabel('이메일').fill(TEST_EMAIL);
  await page.getByLabel('비밀번호').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: '로그인' }).click();

  try {
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1_000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Dashboard 접근 후 로딩 대기 (이미 로그인된 상태 가정).
 */
export async function navigateToDashboard(page: Page): Promise<boolean> {
  await page.goto('/admin');

  if (page.url().includes('/login')) {
    return loginAndWaitForDashboard(page);
  }

  try {
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(500);
    return true;
  } catch {
    return false;
  }
}
