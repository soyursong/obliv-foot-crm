/**
 * QA 브라우저 시뮬 — T-20260606-foot-AUTOCOMPLETE-CROSS-PATIENT-AUDIT
 * 배포 URL(기본 prod) 대상. 자동완성 cross-patient 누설 전수감사 phase2 증거.
 *
 * 감사 결론(코드변경 0): 데이터 연동 자동완성은 (A) 클리닉 마스터 상용구 + (A) customers 인물검색뿐.
 * 환자 간 차트 자유텍스트 distinct 미리보기 (B) 0건. 본 시뮬은 배포본에서 그 경로를 실증한다.
 *
 *  shot1: 미로그인 /customers 직접 접근 → /login 리다이렉트 (감사 대상 빌드의 auth 게이트)
 *  shot2: admin 세션 주입 후 /customers → 고객 목록 렌더 (감사 빌드 라이브)
 *  shot3: 고객 검색창에 이름 입력 → 결과는 인물(이름/전화/차트번호)만. 차트 자유텍스트 미리보기 0건.
 *
 * 사용: node scripts/qa_shot_autocomplete_audit.mjs [BASE_URL]
 */
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.test' });

const BASE = process.argv[2] ?? 'https://obliv-foot-crm.vercel.app';
const OUT = '_handoff/qa_screenshots/T-20260606-foot-AUTOCOMPLETE-CROSS-PATIENT-AUDIT';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;
const EMAIL = process.env.TEST_EMAIL ?? 'test@medibuilder.com';
const PASSWORD = process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })();

fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log('[qa-shot]', ...a);
const results = {};

const browser = await chromium.launch();

// ── shot1: 미로그인 차단 ─────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/admin/customers`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(2000);
  const url = page.url();
  await page.screenshot({ path: path.join(OUT, 'shot1_anon_blocked.png'), fullPage: true });
  results.shot1_anon_blocked = !url.includes('/customers');
  log('shot1 anon final URL:', url, '→ blocked:', results.shot1_anon_blocked);
  await ctx.close();
}

// ── admin 세션 주입 ──────────────────────────────────────────────────
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

// ── shot2: 고객 목록 렌더 ────────────────────────────────────────────
{
  await page.goto(`${BASE}/admin/customers`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(3500);
  const url = page.url();
  await page.screenshot({ path: path.join(OUT, 'shot2_admin_customers.png'), fullPage: true });
  results.shot2_admin_customers = url.includes('/customers');
  log('shot2 admin final URL:', url, '| on /customers:', results.shot2_admin_customers, '| user:', s.user.email);
}

// ── shot3: 고객 검색 자동완성 = 인물검색(이름/전화/차트번호), 차트텍스트 미리보기 0건 ──
{
  const searchSel = 'input[placeholder*="전화번호"]';
  let typed = false;
  try {
    const input = page.locator(searchSel).first();
    await input.waitFor({ state: 'visible', timeout: 8000 });
    await input.click();
    await input.fill('김');           // 흔한 성 1글자 → 인물 후보 트리거
    await page.waitForTimeout(2500);
    typed = true;
  } catch (e) {
    log('shot3 search input not found (fallback to list view):', e.message);
  }
  await page.screenshot({ path: path.join(OUT, 'shot3_customer_search_person.png'), fullPage: true });

  // 노출된 행 텍스트에 차트 자유텍스트(진단/임상경과/메모) 키워드가 없는지 가드
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const leakKeywords = ['진단명:', '임상경과:', '진료메모:', 'diagnosis', 'clinical_progress'];
  const leaked = leakKeywords.filter((k) => bodyText.includes(k));
  results.shot3_typed = typed;
  results.shot3_no_chart_text_leak = leaked.length === 0;
  log('shot3 typed:', typed, '| chart-text leak keywords present:', leaked, '| no-leak:', results.shot3_no_chart_text_leak);
}

await ctx.close();
await browser.close();

fs.writeFileSync(path.join(OUT, 'browser_sim_result.json'), JSON.stringify(results, null, 2));
log('done. screenshots + result →', OUT);
log('SUMMARY:', JSON.stringify(results));
