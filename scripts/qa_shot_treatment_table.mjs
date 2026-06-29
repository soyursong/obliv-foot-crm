/**
 * QA 스크린샷 — T-20260606-foot-THERAPIST-EVAL-VIEWER-ADMIN
 * 배포 URL(기본 prod) 대상 치료 테이블 어드민 게이팅 실증.
 *
 *  shot1: 미로그인 사용자가 /admin/treatment-table 직접 접근 → /login 리다이렉트 (비-어드민 차단)
 *  shot2: admin 세션 주입 후 /admin/treatment-table → 치료 현황 테이블 렌더 (어드민 접근)
 *
 * 사용: node scripts/qa_shot_treatment_table.mjs [BASE_URL]
 */
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.test' });

const BASE = process.argv[2] ?? 'https://obliv-foot-crm.vercel.app';
const OUT = '_handoff/qa_screenshots/T-20260606-foot-THERAPIST-EVAL-VIEWER-ADMIN';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;
const EMAIL = process.env.TEST_EMAIL ?? 'test@medibuilder.com';
const PASSWORD = process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })();

fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log('[qa-shot]', ...a);

const browser = await chromium.launch();

// ── shot1: 미로그인 차단 ──────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/admin/treatment-table`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const url = page.url();
  await page.screenshot({ path: path.join(OUT, 'shot1_anon_blocked.png'), fullPage: true });
  log('shot1 anon final URL:', url, '→ blocked:', !url.includes('/admin/treatment-table'));
  await ctx.close();
}

// ── shot2: admin 접근 ─────────────────────────────────
{
  const supabase = createClient(SUPABASE_URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (error || !data.session) throw new Error('SDK login failed: ' + (error?.message ?? 'no session'));
  const s = data.session;
  const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
  const key = `sb-${ref}-auth-token`;
  const payload = JSON.stringify({
    access_token: s.access_token, refresh_token: s.refresh_token,
    expires_in: s.expires_in, expires_at: s.expires_at,
    token_type: s.token_type, user: s.user,
  });

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ k, v }) => localStorage.setItem(k, v), { k: key, v: payload });
  await page.goto(`${BASE}/admin/treatment-table`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  const url = page.url();
  await page.screenshot({ path: path.join(OUT, 'shot2_admin_treatment_table.png'), fullPage: true });
  const hasTitle = await page.getByText('치료 현황 테이블').isVisible().catch(() => false);
  log('shot2 admin final URL:', url, '| 치료현황테이블 visible:', hasTitle, '| user:', s.user.email);
  await ctx.close();
}

await browser.close();
log('done. screenshots →', OUT);
