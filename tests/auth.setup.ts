/**
 * Auth setup — Supabase JS SDK로 직접 signInWithPassword 후
 * localStorage 세션을 storageState로 저장.
 *
 * UI 로그인보다 빠르고 rate-limit에 강함.
 */
import { test as setup } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// test-results 는 run 마다 cleanable → 프로젝트 루트 `.auth/` 로 분리
const AUTH_FILE = path.join(__dirname, '..', '.auth', 'user.json');

// .env에서 읽은 Supabase 값 (Playwright는 dotenv 자동 로드 안 함)
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';

setup('authenticate', async ({ page }) => {
  const email = process.env.TEST_EMAIL;
  const password = process.env.TEST_PASSWORD;

  if (!email || !password) {
    console.log('[auth.setup] TEST_EMAIL not set — unauthenticated mode');
    await page.goto('/login');
    await page.context().storageState({ path: AUTH_FILE });
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.log('[auth.setup] Supabase env not set — falling back to UI login');
    await uiLogin(page, email, password);
    return;
  }

  // Supabase SDK로 직접 로그인
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    console.log('[auth.setup] SDK login failed:', error?.message ?? 'no session');
    console.log('[auth.setup] Falling back to UI login');
    await uiLogin(page, email, password);
    return;
  }

  const session = data.session;
  console.log('[auth.setup] SDK login successful, injecting session into localStorage');

  // Supabase가 localStorage에 저장하는 키 형식
  const storageKey = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
  const sessionPayload = JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    token_type: session.token_type,
    user: session.user,
  });

  // 앱 페이지로 이동 후 localStorage 주입
  await page.goto('/login');
  await page.evaluate(
    ({ key, value }) => {
      localStorage.setItem(key, value);
    },
    { key: storageKey, value: sessionPayload },
  );

  // 세션이 적용되었는지 확인 (admin으로 이동)
  await page.goto('/admin');
  try {
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
    console.log('[auth.setup] Session injection confirmed — Dashboard loaded');
  } catch {
    console.log('[auth.setup] Dashboard did not load after session injection, but continuing');
  }

  // storageState 저장 (auth dir 보장)
  const authDir = path.dirname(AUTH_FILE);
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });
  await page.context().storageState({ path: AUTH_FILE });
});

/** UI를 통한 폴백 로그인 */
async function uiLogin(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill(password);
  await page.getByRole('button', { name: '로그인' }).click();

  try {
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 20_000 });
    console.log('[auth.setup] UI login successful');
  } catch {
    console.log('[auth.setup] UI login — Dashboard not reached');
  }

  const authDir = path.dirname(AUTH_FILE);
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });
  await page.context().storageState({ path: AUTH_FILE });
}
