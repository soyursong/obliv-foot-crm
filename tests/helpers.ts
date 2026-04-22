/**
 * 테스트 공용 헬퍼
 */
import type { Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const TEST_EMAIL = process.env.TEST_EMAIL ?? '';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? '';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';

/**
 * Supabase SDK로 세션을 가져와 localStorage에 주입 후 Dashboard 로딩 대기.
 * SDK 실패 시 UI 로그인으로 폴백.
 * 반환값: true = 성공, false = 실패(skip 필요)
 */
export async function loginAndWaitForDashboard(page: Page): Promise<boolean> {
  if (!TEST_EMAIL || !TEST_PASSWORD) return false;

  // SDK 직접 로그인 시도
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await supabase.auth.signInWithPassword({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
      });

      if (!error && data.session) {
        const storageKey = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
        const sessionPayload = JSON.stringify({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_in: data.session.expires_in,
          expires_at: data.session.expires_at,
          token_type: data.session.token_type,
          user: data.session.user,
        });

        await page.goto('/login');
        await page.evaluate(
          ({ key, value }) => { localStorage.setItem(key, value); },
          { key: storageKey, value: sessionPayload },
        );
        await page.goto('/admin');
        try {
          await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
          await page.waitForTimeout(1_000);
          return true;
        } catch {
          // SDK 주입 실패 시 UI 폴백
        }
      }
    } catch {
      // SDK 사용 불가 — UI 폴백
    }
  }

  // UI 로그인 폴백
  return uiLogin(page);
}

async function uiLogin(page: Page): Promise<boolean> {
  await page.goto('/login');

  // 이미 인증된 경우
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
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1_500);
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
    await page.waitForTimeout(1_500);
    return true;
  } catch {
    return false;
  }
}
