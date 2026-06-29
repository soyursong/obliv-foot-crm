/**
 * T-20260615-foot-DOCDASH-DONEFILTER-DATEHISTORY — 실 브라우저 렌더 확인.
 * ⑤ 진료 알림판 '진료완료' 섹션 필터 태그(전체|처방확인대기|처방완료) 노출.
 * ⑥ 진료 환자 목록 탭 날짜 < > '오늘' 네비 UI 노출 확인.
 * 실행: TARGET_URL=http://localhost:8081 node --env-file=.env scripts/T-20260615-foot-DOCDASH-DONEFILTER-DATEHISTORY_render.mjs
 */
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const TEST_EMAIL = process.env.TEST_EMAIL ?? 'test@medibuilder.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })();
const TARGET_URL = (process.env.TARGET_URL ?? 'http://localhost:8081').replace(/\/$/, '');
const EVID = path.join(__dirname, '..', 'evidence');

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
  if (error) { console.error('❌ login fail', error.message); process.exit(1); }
  const session = data.session;

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(TARGET_URL + '/login');
  await page.evaluate(([url, sess]) => {
    const ref = url.split('//')[1].split('.')[0];
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess));
  }, [SUPABASE_URL, session]);

  await page.goto(TARGET_URL + '/admin/doctor-tools', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // ⑤ 진료 알림판 탭 (기본) — 진료완료 섹션 필터 태그 존재 확인
  const doneSection = await page.locator('[data-testid="doctor-completed-section"]').count();
  const filterAll = await page.locator('[data-testid="doctor-completed-filter-all"]').count();
  const filterPending = await page.locator('[data-testid="doctor-completed-filter-pending"]').count();
  const filterConfirmed = await page.locator('[data-testid="doctor-completed-filter-confirmed"]').count();
  const filterWrap = await page.locator('[data-testid="doctor-completed-filter"]').count();
  console.log('⑤ doctor-completed-section:', doneSection);
  console.log('⑤ filter wrap (완료환자 있을 때만 노출):', filterWrap, '| all:', filterAll, 'pending:', filterPending, 'confirmed:', filterConfirmed);
  await page.screenshot({ path: path.join(EVID, 'T-20260615-foot-DOCDASH-DONEFILTER-DATEHISTORY_done-section.png'), fullPage: true });

  // 완료 환자가 있으면 필터 클릭 → 행 축소 동작 스모크
  if (filterPending > 0) {
    await page.locator('[data-testid="doctor-completed-filter-pending"]').click();
    await page.waitForTimeout(600);
    const pressed = await page.locator('[data-testid="doctor-completed-filter-pending"]').getAttribute('aria-pressed');
    console.log('⑤ pending 탭 클릭 후 aria-pressed:', pressed);
  }

  // ⑥ 진료 환자 목록 탭 — 날짜 네비 UI 확인
  await page.locator('[data-testid="tab-patient-list"]').click();
  await page.waitForTimeout(1500);
  const prevDay = await page.locator('[data-testid="patient-list-prev-day"]').count();
  const nextDay = await page.locator('[data-testid="patient-list-next-day"]').count();
  const dateHeader = await page.locator('[data-testid="patient-list-date-header"]').count();
  console.log('⑥ 날짜 네비 — prev:', prevDay, 'next:', nextDay, 'header:', dateHeader);
  await page.screenshot({ path: path.join(EVID, 'T-20260615-foot-DOCDASH-DONEFILTER-DATEHISTORY_date-nav.png'), fullPage: true });

  console.log('\nconsole/page errors:', errors.length ? errors.slice(0, 5) : 'none');
  const ok = doneSection > 0 && prevDay > 0 && nextDay > 0 && dateHeader > 0;
  console.log(ok ? '\n✅ RENDER OK' : '\n⚠ RENDER CHECK FAIL');
  await browser.close();
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
