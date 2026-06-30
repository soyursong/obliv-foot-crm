// throwaway 로컬 렌더러 — 시안 v2 PNG 산출 (운영 미반영)
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const dir = dirname(fileURLToPath(import.meta.url));
const url = 'file://' + join(dir, 'mockup_v2.html');

const targets = [
  ['#surfaceA',     'A_reservation_liveslot_v2.png'],
  ['#surfaceB_on',  'B_dashboard_signboard_lit_v2.png'],
  ['#surfaceB_off', 'B_dashboard_signboard_off_v2.png'],
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

for (const [sel, file] of targets) {
  const el = await page.$(sel);
  await el.screenshot({ path: join(dir, file), omitBackground: false });
  console.log('rendered', file);
}

await browser.close();
console.log('done');
