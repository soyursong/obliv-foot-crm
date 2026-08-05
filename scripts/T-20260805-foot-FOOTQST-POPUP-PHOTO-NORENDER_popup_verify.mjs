/**
 * T-20260805-foot-FOOTQST-POPUP-PHOTO-NORENDER — 별도창 팝업 사진 실렌더 검증
 *
 * 로컬 build(vite preview) 대상: 로그인 → 사진 보유 고객 2번차트 → '별도창' 클릭 →
 *   window.open 팝업 캡처 → #hq-photo-mount 에 async 주입된 첨부사진 <img> 실로드 확인.
 *   (prod 미배포 상태 fix 검증 → 로컬 dist. 데이터/스토리지는 prod supabase 사용.)
 *
 * READ-ONLY: mutation 0.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const EMAIL = env.TEST_ADMIN_EMAIL || env.TEST_USER_EMAIL;
const PW    = env.TEST_ADMIN_PW || env.TEST_USER_PASSWORD;
const BASE  = process.env.BASE || 'http://127.0.0.1:4788';
const CUSTOMER = 'bbdc2809-6559-40c6-8aa6-0ee41ef3d42c'; // 김혜주 F-5253, health_q 사진 2건

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();

let ok = false;
try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', EMAIL).catch(() => {});
  await page.fill('input[type=password]', PW).catch(() => {});
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3500);
  console.log('after login url=', page.url());

  await page.goto(`${BASE}/chart/${CUSTOMER}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // '상담내역' 탭 진입 (별도창 버튼은 이 탭 안에 있음)
  await page.getByText('상담내역', { exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(2500);

  // '별도창' 버튼 탐색 (data-testid healthq-doc-window-btn / -modal)
  const btn = page.locator('[data-testid^="healthq-doc-window-btn"]').first();
  const cnt = await btn.count();
  console.log('별도창 버튼 count =', cnt);
  if (cnt === 0) throw new Error('별도창 버튼 미발견 — 화면 진입/스크롤 확인 필요');

  // 팝업 대기 + 클릭
  const [popup] = await Promise.all([
    ctx.waitForEvent('page'),
    btn.click(),
  ]);
  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  await popup.waitForTimeout(3500); // async 사진 주입 대기

  const title = await popup.title().catch(() => '');
  console.log('popup title =', title);

  const info = await popup.evaluate(() => {
    const mount = document.getElementById('hq-photo-mount');
    const imgs = Array.from(document.querySelectorAll('img'))
      .filter((i) => /foot-health-q-photos|health-q/.test(i.src));
    return {
      mountExists: !!mount,
      mountHasContent: !!mount && mount.innerHTML.trim().length > 0,
      sectionTitle: /고객 첨부 사진/.test(document.body.innerText),
      imgs: imgs.map((i) => ({ loaded: i.complete && i.naturalWidth > 0, w: i.naturalWidth, cap: i.alt })),
    };
  });
  console.log('mount exists =', info.mountExists);
  console.log('mount has content =', info.mountHasContent);
  console.log('"고객 첨부 사진" 섹션 텍스트 present =', info.sectionTitle);
  console.log('popup photo <img> count =', info.imgs.length);
  info.imgs.forEach((i, n) => console.log(`   img[${n}] loaded=${i.loaded} natW=${i.w} label=${i.cap}`));

  await popup.screenshot({ path: 'scripts/_footqst_popup_photo_verify.png', fullPage: true });
  console.log('popup screenshot: scripts/_footqst_popup_photo_verify.png');

  const allLoaded = info.imgs.length > 0 && info.imgs.every((i) => i.loaded);
  ok = info.mountHasContent && info.sectionTitle && allLoaded;
  console.log('\n=== VERDICT:', ok ? 'PASS ✅ (팝업에 첨부사진 실렌더)' : 'FAIL ❌', '===');
} catch (e) {
  console.log('ERR', e.message);
} finally {
  await browser.close();
  process.exit(ok ? 0 : 1);
}
