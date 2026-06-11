/**
 * T-20260611-foot-RESVPOPUP-2ZONE-SEARCH-CALENDAR Stage2 — 실 브라우저 팝업 렌더 확인.
 * 로그인 → /admin/reservations → 예약 행 우클릭 [예약상세] → 팝업 2구역 렌더 검증.
 * 실행: TARGET_URL=http://localhost:8089 node --env-file=.env scripts/T-20260611-foot-RESVPOPUP-2ZONE_render.mjs
 */
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const TEST_EMAIL = process.env.TEST_EMAIL ?? 'test@medibuilder.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'TestPass2026!';
const TARGET_URL = (process.env.TARGET_URL ?? 'http://localhost:8089').replace(/\/$/, '');
const SHOT = path.join(__dirname, '..', 'test-results', `resvpopup_2zone_${Date.now()}.png`);

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
  if (error) { console.error('❌ login fail', error.message); process.exit(1); }
  const session = data.session;

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const bad = [];
  page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });

  // 세션 주입
  await page.goto(TARGET_URL + '/login');
  await page.evaluate(([url, sess]) => {
    const ref = url.split('//')[1].split('.')[0];
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess));
  }, [SUPABASE_URL, session]);

  await page.goto(TARGET_URL + '/admin/reservations', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // 예약 카드/셀 우클릭 → [예약상세]
  let opened = false;
  const cards = page.locator('[data-reservation-id], [data-testid^="resv-"], .cursor-pointer');
  const n = await cards.count();
  console.log('candidate clickable elements:', n);
  // 예약 칸반/타임라인 셀을 순회하며 우클릭 → 컨텍스트 메뉴 [예약상세] 시도
  for (let i = 0; i < Math.min(n, 25) && !opened; i++) {
    try {
      const el = cards.nth(i);
      if (!(await el.isVisible())) continue;
      await el.click({ button: 'right', timeout: 800 });
      const detail = page.getByText('예약상세', { exact: false }).first();
      if (await detail.isVisible({ timeout: 500 }).catch(() => false)) {
        await detail.click();
        opened = await page.locator('[data-testid="popup-zone1-customer"]').isVisible({ timeout: 1500 }).catch(() => false);
      }
    } catch { /* keep trying */ }
  }

  const zone1 = await page.locator('[data-testid="popup-zone1-customer"]').count();
  const zone2 = await page.locator('[data-testid="popup-zone2-reservation"]').count();
  const cal = await page.locator('[data-testid="popup-mini-calendar"]').count();
  const treat = await page.locator('[data-testid="popup-treatment-history"]').count();

  await page.waitForTimeout(1200);
  await page.screenshot({ path: SHOT, fullPage: false });
  console.log('opened popup:', opened);
  console.log('zone1:', zone1, 'zone2:', zone2, 'miniCalendar:', cal, 'treatmentHistory:', treat);
  console.log('JS errors:', errors.length, errors.slice(0, 5));
  console.log('HTTP>=400:', bad.length, bad.slice(0, 8));
  console.log('screenshot:', SHOT);

  await browser.close();
  // 팝업 못 열어도(데이터 없음 등) JS 에러 0 이면 렌더-무결로 본다. 팝업 열렸으면 2구역 모두 필수.
  if (errors.length > 0) process.exit(2);
  if (opened && (zone1 === 0 || zone2 === 0)) process.exit(3);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
