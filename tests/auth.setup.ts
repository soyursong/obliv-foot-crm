/**
 * Auth setup — Supabase JS SDK로 직접 signInWithPassword 후
 * localStorage 세션을 storageState로 저장.
 *
 * 전제: src/lib/supabase.ts 가 VITE_DISABLE_AUTH_LOCK=1 일 때
 *       navigator.locks 우회(lockNoop) 모드로 동작.
 *       이 플래그가 없으면 새 BrowserContext 에서 getSession() 이 hang.
 *
 * UI 로그인 대비:
 *   - SDK 로그인: ~1.5s, rate-limit 거의 없음
 *   - UI 로그인: ~5~10s, signInWithPassword 폼 매번 트리거
 */
import { test as setup, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUTH_FILE = path.join(__dirname, '..', '.auth', 'user.json');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const TEST_EMAIL = process.env.TEST_EMAIL ?? 'test@medibuilder.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'TestPass2026!';

setup('authenticate', async ({ page }) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 .env에 없습니다.');
  }

  // 1) Supabase SDK로 직접 로그인 → access_token + refresh_token 획득
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });

  if (error || !data.session) {
    throw new Error(`[auth.setup] SDK login failed: ${error?.message ?? 'no session'}`);
  }

  const session = data.session;
  console.log('[auth.setup] SDK login OK — user:', session.user.email);

  // 2) Vite dev origin 으로 진입 후 localStorage 주입
  //    Supabase JS 가 사용하는 키 형식: sb-{ref}-auth-token
  const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
  const storageKey = `sb-${ref}-auth-token`;
  const sessionPayload = JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    token_type: session.token_type,
    user: session.user,
  });

  await page.goto('/login');
  await page.evaluate(
    ({ key, value }) => {
      localStorage.setItem(key, value);
    },
    { key: storageKey, value: sessionPayload },
  );

  // 3) /admin 으로 이동 → AuthProvider 가 lockNoop 으로 즉시 세션 인식 → Dashboard 렌더
  await page.goto('/admin');
  try {
    await expect(page.getByText('대시보드', { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });
    console.log('[auth.setup] Session injection confirmed — Dashboard loaded');
  } catch (e) {
    // hang 이면 lockNoop 분기가 적용 안 된 것 — 즉시 실패
    throw new Error(
      `[auth.setup] Dashboard 로딩 실패. VITE_DISABLE_AUTH_LOCK=1 이 dev 서버에 전달되었는지 확인. (${(e as Error).message})`,
    );
  }

  // 4) storageState 저장
  const authDir = path.dirname(AUTH_FILE);
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });
  await page.context().storageState({ path: AUTH_FILE });
  console.log('[auth.setup] storageState saved →', AUTH_FILE);
});
