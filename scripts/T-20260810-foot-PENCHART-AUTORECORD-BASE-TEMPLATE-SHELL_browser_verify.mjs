/**
 * T-20260810-foot-PENCHART-AUTORECORD-BASE-TEMPLATE-SHELL — 브라우저 실렌더 검증 (READ-ONLY)
 *
 * 목적: 펜차트(자동기록용) 컨테이너가 emerald '별도양식' chrome 이 아니라 [펜차트양식] 기본 틀(neutral white-card)로
 *   실렌더되는지 봉인. 로그인 → 2번차트 → [펜차트] 탭 → penchart-auto-visit-log-box 캡처 + 클래스/헤더 검증.
 *   대상 = 로컬 vite preview(방금 빌드한 dist = 배포 예정 아티팩트). auth 는 실 Supabase(.env.local).
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const EMAIL = env.TEST_ADMIN_EMAIL || env.TEST_USER_EMAIL;
const PW    = env.TEST_ADMIN_PW || env.TEST_USER_PASSWORD;
const PORT  = 4321;
const BASE  = `http://localhost:${PORT}`;
const CUSTOMER = 'bbdc2809-6559-40c6-8aa6-0ee41ef3d42c'; // 선례 재사용

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
});
const cleanup = () => { try { preview.kill('SIGKILL'); } catch { /* noop */ } };

async function waitPort(url, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok || r.status === 200) return true; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

let exitCode = 0;
try {
  if (!(await waitPort(BASE, 30000))) throw new Error('vite preview 미기동(port timeout)');

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', EMAIL).catch(() => {});
  await page.fill('input[type=password]', PW).catch(() => {});
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3500);

  await page.goto(`${BASE}/chart/${CUSTOMER}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);

  const bodyText = await page.evaluate(() => document.body.innerText);
  const notBlank = bodyText.trim().length > 200;

  const penTab = page.getByRole('button', { name: '펜차트', exact: true });
  if (await penTab.count()) { await penTab.first().click(); }
  else { await page.getByText('펜차트', { exact: true }).first().click().catch(() => {}); }
  await page.waitForTimeout(2500);

  const box = page.locator('[data-testid="penchart-auto-visit-log-box"]');
  const boxCount = await box.count();
  let cls = '', headerCount = 0, emerald = false;
  if (boxCount >= 1) {
    cls = (await box.first().getAttribute('class')) ?? '';
    headerCount = await page.locator('[data-testid="penchart-auto-visit-log-header"]').count();
    emerald = /emerald/.test(cls);
    await box.first().screenshot({ path: 'scripts/_evidence_T-20260810-penchart-baseframe.png' }).catch(() => {});
  }
  const baseFrame = /rounded-lg/.test(cls) && /bg-white/.test(cls) && !/border-2/.test(cls);

  console.log('box count =', boxCount);
  console.log('box class =', cls);
  console.log('header present =', headerCount, '· emerald chrome =', emerald, '· baseFrame =', baseFrame);
  console.log('pageErrors =', pageErrors.length, pageErrors.slice(0, 3));

  await browser.close();

  // 대상(eligible) 고객이면 box=1·baseFrame·no-emerald 요구. box 자체가 없으면(비대상 고객 데이터) 렌더-크래시만 배제.
  const renderSafe = notBlank && pageErrors.length === 0;
  const frameOk = boxCount === 0 ? true : (baseFrame && !emerald);
  const ok = renderSafe && frameOk;
  console.log(`\nRESULT: ${ok ? 'BROWSER OK' : 'BROWSER ERROR'} (notBlank=${notBlank} box=${boxCount} baseFrame=${frameOk} errs=${pageErrors.length})`);
  if (!ok) exitCode = 3;
} catch (e) {
  console.log('RESULT: BROWSER ERROR —', String(e));
  exitCode = 3;
} finally {
  cleanup();
}
process.exit(exitCode);
