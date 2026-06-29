#!/usr/bin/env node
// T-20260611-foot-BILLDETAIL-CONSULTFEE-COPAY-REWORK_login_verify.mjs
// Canonical prod login → dashboard entry verification for foot CRM.
//
// WHY THIS EXISTS:
//   supervisor phase2 QA used /Users/domas/scripts/diag-browser.mjs which, after
//   clicking the login button, immediately calls page.goto(rootUrl). That navigation
//   ABORTS the in-flight Supabase signInWithPassword fetch, so the SPA's catch handler
//   logs "TypeError: Failed to fetch" and the page is left at /login. It is a harness
//   race, NOT an app/Supabase/CORS/account fault. Verified: curl auth = 200, and a
//   browser login that waits (no premature goto) reaches /admin with auth 200.
//
// This script logs in the SAME way the real user does and WAITS for the post-login
// navigation instead of forcing a goto, then asserts the dashboard was reached.
//
// Usage:
//   node scripts/T-20260611-foot-BILLDETAIL-CONSULTFEE-COPAY-REWORK_login_verify.mjs \
//     [--url=https://obliv-foot-crm.vercel.app] \
//     [--email=test@medibuilder.com] [--password=$TEST_PASSWORD]
// Exit 0 = dashboard reached, 1 = failed.

const PLAYWRIGHT_CANDIDATES = [
  '/Users/domas/Documents/GitHub/obliv-foot-crm/node_modules/playwright/index.mjs',
  '/Users/domas/claude-sync/work/obliv-foot-crm/node_modules/playwright/index.mjs',
];
let chromium;
for (const p of PLAYWRIGHT_CANDIDATES) {
  try { ({ chromium } = await import(p)); break; } catch (_) { /* next */ }
}
if (!chromium) { console.error('playwright_not_found'); process.exit(3); }

const arg = (k, d) => process.argv.slice(2).find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const url = arg('url', 'https://obliv-foot-crm.vercel.app');
const email = arg('email', 'test@medibuilder.com');
const password = arg('password', process.env.TEST_PASSWORD ?? process.env.TEST_USER_PASSWORD);
if (!password) { console.error('TEST_PASSWORD env (or --password=) required — no plaintext fallback'); process.exit(2); }
const origin = new URL(url).origin;

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const screenshot = `/tmp/foot-login-verify-${ts}.png`;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

const authResp = [];
const authFailed = [];
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('response', r => { if (r.url().includes('/auth/v1/token')) authResp.push(r.status()); });
page.on('requestfailed', r => { if (r.url().includes('/auth/v1/')) authFailed.push(`${r.url()} :: ${r.failure()?.errorText}`); });

let err = null;
try {
  await page.goto(origin + '/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.fill('input[type=email], input[name=email]', email);
  await page.fill('input[type=password], input[name=password]', password);
  await page.click('button[type=submit], button:has-text("로그인")');
  // KEY: wait for the app to navigate AWAY from /login by itself. Do NOT page.goto().
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 20000 });
  await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
} catch (e) { err = e.message; }

const finalUrl = page.url();
const title = await page.title().catch(() => '');
const rootLen = await page.evaluate(() => document.getElementById('root')?.innerHTML.length ?? 0).catch(() => 0);
await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
await browser.close();

const enteredDashboard = !/\/login(\b|$)/.test(finalUrl) && authResp.includes(200);
const result = {
  request_url: url,
  final_url: finalUrl,
  title,
  auth_responses: authResp,
  auth_failed: authFailed,
  console_errors: consoleErrors,
  root_length: rootLen,
  navigation_error: err,
  entered_dashboard: enteredDashboard,
  screenshot,
  ts: new Date().toISOString(),
};
console.log(JSON.stringify(result, null, 2));
process.exit(enteredDashboard ? 0 : 1);
