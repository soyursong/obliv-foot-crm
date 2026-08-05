/**
 * T-20260805-foot-FOOTQST-POPUP-PHOTO-NORENDER — 브라우저 실렌더 검증 (READ-ONLY)
 * prod(obliv-foot-crm.pages.dev) 로그인 → 사진 보유 고객 2번차트 → ResultCard 인라인 썸네일 실렌더 확인.
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
const BASE  = 'https://obliv-foot-crm.pages.dev';
const CUSTOMER = 'bbdc2809-6559-40c6-8aa6-0ee41ef3d42c';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();
page.on('console', (m) => { const t = m.text(); if (/photo|health_q|signed|사진|FOOTQST/i.test(t)) console.log('  [browser]', t); });

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  // 로그인
  await page.fill('input[type=email]', EMAIL).catch(() => {});
  await page.fill('input[type=password]', PW).catch(() => {});
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3500);
  console.log('after login url=', page.url());

  await page.goto(`${BASE}/chart/${CUSTOMER}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);

  // 발건강질문지 섹션까지 스크롤 & 카드 펼치기 시도
  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('has 발건강질문지 text:', /발건강질문지/.test(bodyText));
  console.log('has 첨부 사진 text:', /첨부 사진/.test(bodyText));

  // 첨부 사진 img 개수 (foot-health-q-photos signed url)
  const imgInfo = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img'))
      .filter((i) => /foot-health-q-photos|health-q/.test(i.src));
    return imgs.map((i) => ({ complete: i.complete, w: i.naturalWidth, h: i.naturalHeight, src: i.src.slice(0, 90) }));
  });
  console.log('inline health-q photo <img> count =', imgInfo.length);
  imgInfo.forEach((i) => console.log('   img loaded=', i.complete && i.w > 0, 'natW=', i.w, i.src));

  await page.screenshot({ path: 'scripts/_footqst_photo_verify.png', fullPage: true });
  console.log('screenshot saved: scripts/_footqst_photo_verify.png');
} catch (e) {
  console.log('ERR', e.message);
} finally {
  await browser.close();
}
