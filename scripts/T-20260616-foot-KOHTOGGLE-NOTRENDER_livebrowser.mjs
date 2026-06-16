/**
 * T-20260616-foot-KOHTOGGLE-NOTRENDER — 라이브 실브라우저 렌더 검증
 * (READ-ONLY 네비게이션 — 토글 클릭 안 함, prod write 0)
 * obliv-foot-crm.vercel.app 에 prod 세션 주입 → /chart/:id 패키지 탭 → koh-request-toggle 가시성.
 */
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { URL } from 'url';
import fs from 'fs';

const env = {};
for (const l of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const SITE = 'https://obliv-foot-crm.vercel.app';
const SB = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const EMAIL = env.TEST_EMAIL || env.TEST_USER_EMAIL || 'test@medibuilder.com';
const PW = env.TEST_PASSWORD || env.TEST_USER_PASSWORD || 'TestPass2026!';
const ref = new URL(SB).hostname.split('.')[0];
const storageKey = `sb-${ref}-auth-token`;

const CUSTOMERS = [
  { id: '83ab4fe1-0bbc-4dfc-ab3b-f01378144707', label: '83ab4fe1(김민경)' },
  { id: '16434582-50cf-46c6-81f7-13d1c959a25e', label: '16434582(박민석)' },
];

const sb = createClient(SB, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PW });
if (error || !data.session) throw new Error(`SDK login failed: ${error?.message}`);
const s = data.session;
console.log('✅ SDK login OK —', s.user.email);
const payload = JSON.stringify({
  access_token: s.access_token, refresh_token: s.refresh_token,
  expires_in: s.expires_in, expires_at: s.expires_at, token_type: s.token_type, user: s.user,
});

const browser = await chromium.launch();
const results = [];
for (const incognito of [false, true]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${SITE}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ k, v }) => localStorage.setItem(k, v), { k: storageKey, v: payload });
  for (const cust of CUSTOMERS) {
    await page.goto(`${SITE}/chart/${cust.id}`, { waitUntil: 'networkidle' });
    let tabClicked = false;
    try {
      await page.getByText('패키지', { exact: true }).first().click({ timeout: 8000 });
      tabClicked = true;
    } catch { /* 탭 못찾음 */ }
    await page.waitForTimeout(1800);
    const toggle = page.locator('[data-testid="koh-request-toggle"]');
    let visible = false;
    try { visible = await toggle.isVisible({ timeout: 5000 }); } catch { visible = false; }
    let stateText = '';
    if (visible) {
      try { stateText = (await page.locator('[data-testid="koh-request-state"]').first().innerText()).trim(); } catch {}
    }
    const tag = `${incognito ? '시크릿' : '일반'} / ${cust.label}`;
    const shot = `evidence/T-20260616-foot-KOHTOGGLE-NOTRENDER_live_${incognito ? 'incognito' : 'normal'}_${cust.id.slice(0, 8)}.png`;
    await page.screenshot({ path: shot, fullPage: false });
    results.push({ tag, tabClicked, visible, stateText, shot });
    console.log(`   ${visible ? '✅렌더 O' : '❌렌더 X'}  ${tag}  tab=${tabClicked}  state=${stateText || '-'}  → ${shot}`);
  }
  await ctx.close();
}
await browser.close();
console.log('\n── 요약 ──');
for (const r of results) console.log(`   ${r.visible ? '✅' : '❌'} ${r.tag}  state=${r.stateText || '-'}`);
const allVisible = results.every((r) => r.visible);
console.log(`\n${allVisible ? '✅ 전 케이스 토글 렌더 O — fix 정상' : '❌ 일부 미노출 — fix 실패 의심'}`);
