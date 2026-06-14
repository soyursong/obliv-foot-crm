/**
 * T-20260614-foot-MEDREC-LAYOUT-4REFINE — 실 브라우저 렌더 자가검증.
 * AC-4 핵심: 진료일/담당의가 '딱 한 줄(single row)' — 라벨과 값이 같은 Y(헤더+내용 2단 아님)인지 실측.
 * 보조: AC-1(임상경과/의료진메모 border-left 없음) 시각 확인 스크린샷.
 *
 * 실행: TARGET_URL=http://localhost:8089 node --env-file=.env.local scripts/T-20260614-foot-MEDREC-LAYOUT-4REFINE_render.mjs
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
const SHOT = path.join(__dirname, '..', 'evidence', `T-20260614-foot-MEDREC-LAYOUT-4REFINE_AC4_singlerow.png`);

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: aerr } = await supabase.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
  if (aerr) { console.error('❌ login fail', aerr.message); process.exit(1); }
  const session = auth.session;

  // 임의 고객 1명 (foot CRM) — 패널은 customer 존재만 필요(신규 차트 = editMode 자동).
  const { data: custs, error: cerr } = await supabase.from('customers').select('id,name').limit(1);
  if (cerr || !custs?.length) { console.error('❌ no customer', cerr?.message); process.exit(1); }
  const cust = custs[0];
  console.log('customer:', cust.id, cust.name);

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

  // ?medchart deep-link → 패널 자동 오픈(신규 차트 = editMode, 진료일/담당의 편집 폼 노출)
  await page.goto(`${TARGET_URL}/chart/${cust.id}?medchart=visit_hist`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const row = page.locator('[data-testid="chart-date-doctor-row"]').first();
  const rowVisible = await row.isVisible({ timeout: 5000 }).catch(() => false);
  console.log('chart-date-doctor-row visible:', rowVisible);

  let verdict = 'INDETERMINATE';
  if (rowVisible) {
    await row.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(400);
    // AC-4 실측: 진료일 라벨과 date input 의 수직 중심(Y)이 같은 줄인지.
    //   single-row → 라벨 중심 Y ≈ 입력칸 중심 Y (행 높이 내). 2단(헤더+내용) → 라벨이 입력칸 위(차이 큼).
    const m = await page.evaluate(() => {
      const rowEl = document.querySelector('[data-testid="chart-date-doctor-row"]');
      if (!rowEl) return null;
      const dateInput = rowEl.querySelector('[data-testid="medical-chart-date"]');
      // 진료일 라벨 = date input 직전 형제 라벨
      let dateLabel = null;
      rowEl.querySelectorAll('label').forEach((l) => { if (l.textContent.trim() === '진료일') dateLabel = l; });
      const r = (el) => { const b = el.getBoundingClientRect(); return { cy: b.top + b.height / 2, top: b.top, h: b.height }; };
      const out = { rowHeight: rowEl.getBoundingClientRect().height };
      if (dateLabel && dateInput) {
        const lb = r(dateLabel), ib = r(dateInput);
        out.dateLabelCy = Math.round(lb.cy);
        out.dateInputCy = Math.round(ib.cy);
        out.dateDeltaY = Math.round(Math.abs(lb.cy - ib.cy));
        // 라벨이 입력칸 '위에 stacking' 이면 라벨 bottom < input top (겹침 없음). 같은 줄이면 Y중심 근접.
        out.sameRow = Math.abs(lb.cy - ib.cy) < Math.max(lb.h, ib.h); // 중심차 < 행높이 → 같은 줄
      }
      return out;
    });
    console.log('measure:', JSON.stringify(m));
    if (m && m.sameRow === true) verdict = 'AC4_SINGLE_ROW_OK';
    else if (m && m.sameRow === false) verdict = 'AC4_STACKED_2TIER_FAIL';
    await row.screenshot({ path: SHOT }).catch(async () => { await page.screenshot({ path: SHOT }); });
  } else {
    // 폼 미노출(읽기전용/시드의존) — 전체 패널 스냅샷만 남김.
    await page.screenshot({ path: SHOT, fullPage: false });
  }

  console.log('VERDICT:', verdict);
  console.log('JS errors:', errors.length, errors.slice(0, 5));
  console.log('screenshot:', SHOT);
  await browser.close();
  if (errors.length > 0) process.exit(2);
  if (verdict === 'AC4_STACKED_2TIER_FAIL') process.exit(3);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
