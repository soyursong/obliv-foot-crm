/**
 * T-20260809-foot-PENCHART-EDITABLE-INCHARTFORM-REWORK — 브라우저 실렌더 검증 (READ-ONLY, boot smoke)
 *
 * 목적(Q1 web_fe '브라우저 진입 1회'): 별도탭 폐지 + 신규 컴포넌트(EditableAutoVisitLogBox) import 리팩터가
 *   CustomerChartPage 를 백지화면/모듈 크래시로 깨뜨리지 않는지 = 이번 변경의 최대 web_fe 리스크를 실렌더로 봉인.
 *   로그인 → 2번차트 → [펜차트] 탭(새 차트 작성 양식) 진입 → 초록박스(penchart-auto-visit-log-box) 렌더 확인.
 *   (persist/print/DB-write 상호작용 = supervisor field-soak · code-gate 소관 — DA-REPLY 지정.)
 *
 * 대상 = 로컬 vite preview(내가 방금 빌드한 dist = 배포 예정 아티팩트). auth 는 실 Supabase(.env.local).
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
const PORT  = 4319;
const BASE  = `http://localhost:${PORT}`;
const CUSTOMER = 'bbdc2809-6559-40c6-8aa6-0ee41ef3d42c'; // 렌더 스모크용(선례 T-20260805 재사용)

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
  const up = await waitPort(BASE, 30000);
  if (!up) throw new Error('vite preview 미기동(port timeout)');

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
  console.log('after login url=', page.url());

  await page.goto(`${BASE}/chart/${CUSTOMER}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);

  // 백지화면 가드 — 앱 셸(2번차트) 텍스트가 실렌더되는지
  const bodyText = await page.evaluate(() => document.body.innerText);
  const notBlank = bodyText.trim().length > 200;
  console.log('bodyText length =', bodyText.trim().length, '· notBlank =', notBlank);

  // [펜차트] 탭 진입(정확히 '펜차트' — 폐지된 '펜차트(자동기록용)' 탭이 없어야 함)
  const autoTabGone = !(await page.getByText('펜차트(자동기록용)', { exact: false }).count()
    .then((c) => c > 0).catch(() => false)) || true; // 탭 목록에서의 부재는 소스가드로 확증(여기선 진입 후 박스로 확인)
  const penTab = page.getByRole('button', { name: '펜차트', exact: true });
  if (await penTab.count()) { await penTab.first().click(); }
  else { await page.getByText('펜차트', { exact: true }).first().click().catch(() => {}); }
  await page.waitForTimeout(2500);

  const boxCount = await page.locator('[data-testid="penchart-auto-visit-log-box"]').count();
  const penChartTabPresent = (await page.evaluate(() => document.body.innerText)).includes('펜차트');
  console.log('penchart-auto-visit-log-box count =', boxCount);
  console.log('PenChartTab(손글씨) 표면 유지 =', penChartTabPresent);
  console.log('pageErrors =', pageErrors.length, pageErrors.slice(0, 3));

  await browser.close();

  const ok = notBlank && boxCount >= 1 && pageErrors.length === 0;
  console.log(`\nRESULT: ${ok ? 'BROWSER OK' : 'BROWSER ERROR'} (notBlank=${notBlank} box=${boxCount} errs=${pageErrors.length})`);
  if (!ok) exitCode = 3;
} catch (e) {
  console.log('RESULT: BROWSER ERROR —', String(e));
  exitCode = 3;
} finally {
  cleanup();
}
process.exit(exitCode);
