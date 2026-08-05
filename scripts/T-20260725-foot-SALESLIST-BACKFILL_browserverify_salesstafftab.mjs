/**
 * T-20260725-foot-SALESLIST-MISSING-RECORDS-BACKFILL — dev-foot POSTCHECK (apply-후 브라우저 육안검증)
 *   supervisor MSG-20260805-230425-jwv9 §8-2: SalesStaffTab(담당치료사별 화장품 매출집계)에서
 *   김규리 CTB 3건(F-4550 이영수 / F-4906 백연재 / F-5016 김미성, 각 15,000) 반영·귀속 표시 확인.
 *   실 prod(pages.dev) 로그인 → 매출집계 → 담당치료사별 탭 → 7월 범위 → 김규리 화장품 칸 클릭 → 드릴다운.
 *   READ-ONLY(집계 조회만). 실행:
 *     TARGET_URL=https://obliv-foot-crm.pages.dev node --env-file=.env.local scripts/..._browserverify_salesstafftab.mjs
 */
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const EMAIL = process.env.TEST_ADMIN_EMAIL ?? process.env.TEST_EMAIL ?? 'test@medibuilder.com';
const PASSWORD = process.env.TEST_ADMIN_PW ?? process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_ADMIN_PW/TEST_PASSWORD env required'); })();
const TARGET_URL = (process.env.TARGET_URL ?? 'https://obliv-foot-crm.pages.dev').replace(/\/$/, '');
const KIMGYURI = '3a0c6774-2bd9-4018-bb38-ef6fab75d04b';
// 기본 basis = 차감기준(deduction) → 화장품 칸 testId. 금액은 basis 무관(cosmeticBySeller 파생).
const CELL_TID = `sales-staff-deduct-cosmetic-${KIMGYURI}`;
const CELL_TID_ALT = `sales-staff-cosmetic-therapist-${KIMGYURI}`; // 수납기준 폴백
const SHOT = path.join(__dirname, '..', 'test-results', `salesstafftab_kimgyuri_ctb_${Date.now()}.png`);
// 백필 대상 3차트 (7월 범위 김규리 화장품 7건 중 이 3건이 백필분)
const TARGETS = [
  { name: '이영수', chart: 'F-4550' },
  { name: '백연재', chart: 'F-4906' },
  { name: '김미성', chart: 'F-5016' },
];

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (error) { console.error('❌ login fail', error.message); process.exit(1); }
  const session = data.session;
  console.log('✓ login OK as', EMAIL, '(target:', TARGET_URL + ')');

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // 세션 주입
  await page.goto(TARGET_URL + '/login');
  await page.evaluate(([url, sess]) => {
    const ref = url.split('//')[1].split('.')[0];
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess));
  }, [SUPABASE_URL, session]);

  // 매출집계
  await page.goto(TARGET_URL + '/admin/sales', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // 담당치료사별 탭
  await page.getByRole('tab', { name: '담당치료사별' }).click().catch(async () => {
    await page.getByText('담당치료사별', { exact: false }).first().click();
  });
  await page.waitForTimeout(800);

  // 기간 = 2026-07 직접입력 (백필 방문일 07-22/07-25 포함)
  await page.locator('[data-testid="sales-preset-custom"]').click();
  await page.waitForTimeout(300);
  const setDate = async (tid, v) => {
    const el = page.locator(`[data-testid="${tid}"]`);
    await el.fill(v);
    await el.dispatchEvent('change');
  };
  await setDate('sales-date-to', '2026-07-31');
  await setDate('sales-date-from', '2026-07-01');
  await page.waitForTimeout(2500); // 쿼리 refetch

  // 김규리 화장품 칸 존재 + 금액 확인 (차감기준 default, 없으면 수납기준 폴백)
  let cell = page.locator(`[data-testid="${CELL_TID}"]`);
  if (await cell.count() === 0) cell = page.locator(`[data-testid="${CELL_TID_ALT}"]`);
  const cellCount = await cell.count();
  let cellText = '';
  if (cellCount > 0) cellText = (await cell.first().innerText().catch(() => '')).trim();
  console.log('김규리 화장품 칸 testId=', CELL_TID, '| count=', cellCount, '| text=', JSON.stringify(cellText));

  if (cellCount === 0) {
    await page.screenshot({ path: SHOT, fullPage: true });
    console.error('❌ 김규리 화장품 칸 미발견 — 로그인 role/렌더 확인 필요. screenshot:', SHOT);
    await browser.close();
    process.exit(4);
  }

  // 칸 클릭 → 드릴다운 팝업
  await cell.first().click();
  await page.waitForTimeout(1200);
  const dialogTitle = (await page.locator('[data-testid="cosmetic-dialog-title"]').innerText().catch(() => '')).trim();
  const listText = (await page.locator('[data-testid="cosmetic-dialog-list"]').innerText().catch(() => '')).trim();
  console.log('팝업 title:', JSON.stringify(dialogTitle));
  console.log('팝업 목록 텍스트:\n' + listText);

  await page.screenshot({ path: SHOT, fullPage: true });

  // 검증: 팝업에 백필 3차트 모두 표기 + 각 이름
  const found = TARGETS.map((t) => ({
    ...t,
    ok: listText.includes(t.name) && listText.includes(t.chart),
  }));
  found.forEach((f) => console.log(`${f.ok ? '✅' : '❌'} ${f.chart} ${f.name} 팝업 표기`));

  const allTargets = found.every((f) => f.ok);
  const titleOk = dialogTitle.includes('김규리');
  const noJsErr = errors.length === 0;
  console.log(`\ntitle 김규리 포함: ${titleOk ? '✅' : '❌'} | 백필 3차트 전부 표기: ${allTargets ? '✅' : '❌'} | JS에러 0: ${noJsErr ? '✅' : '❌'}(${errors.length})`);
  if (errors.length) console.log('JS errors:', errors.slice(0, 5));
  console.log('screenshot:', SHOT);

  await browser.close();
  if (titleOk && allTargets && noJsErr) {
    console.log('\n✅ BROWSER POSTCHECK PASS — SalesStaffTab 김규리 화장품 칸에 백필 CTB 3건 반영·귀속 렌더 확인.');
    process.exit(0);
  }
  process.exit(5);
}
main().catch((e) => { console.error('❌ BROWSER VERIFY ERROR:', e.message); process.exit(1); });
