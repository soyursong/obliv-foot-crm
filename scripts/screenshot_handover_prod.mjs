/**
 * T-20260605-foot-HANDOVER-DBFIX — PROD /admin/handover UI 렌더 스크린샷 증빙
 * 운영(https://obliv-foot-crm.vercel.app)에 로그인 세션 주입 후 인수인계 보드 진입 →
 * "schema cache" 에러 없이 보드 렌더됨을 캡처. (data-layer 저장/재조회는 verify_handover_ac34_prod.mjs)
 *
 * 실행: node scripts/screenshot_handover_prod.mjs
 */
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = {};
for (const l of fs.readFileSync('.env', 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const SUPA_URL = env.VITE_SUPABASE_URL, ANON = env.VITE_SUPABASE_ANON_KEY;
const EMAIL = process.env.TEST_EMAIL || 'test@medibuilder.com';
const PASS = process.env.TEST_PASSWORD || (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })();
const PROD = 'https://obliv-foot-crm.vercel.app';
const OUT = `/tmp/handover_prod_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;

const supa = createClient(SUPA_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await supa.auth.signInWithPassword({ email: EMAIL, password: PASS });
if (error) { console.error('login fail', error.message); process.exit(1); }
const s = data.session;
const ref = new URL(SUPA_URL).hostname.split('.')[0];
const key = `sb-${ref}-auth-token`;
const payload = JSON.stringify({ access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in, expires_at: s.expires_at, token_type: s.token_type, user: s.user });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`${PROD}/login`, { waitUntil: 'domcontentloaded' });
await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key, value: payload });
await page.goto(`${PROD}/admin/handover`, { waitUntil: 'networkidle' });

let rendered = false;
try {
  await page.getByRole('heading', { name: '직원 근무 캘린더' }).waitFor({ timeout: 20000 });
  rendered = true;
} catch { /* fall through */ }

await page.screenshot({ path: OUT, fullPage: true });
const schemaErr = errors.filter(e => /schema cache|handover_notes/i.test(e));
console.log(JSON.stringify({
  prod_url: `${PROD}/admin/handover`,
  account: EMAIL,
  board_heading_rendered: rendered,
  schema_cache_errors: schemaErr.length,
  schema_cache_error_samples: schemaErr.slice(0, 3),
  screenshot: OUT,
}, null, 2));

await browser.close();
process.exit(rendered && schemaErr.length === 0 ? 0 : 1);
