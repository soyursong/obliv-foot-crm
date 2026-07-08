// T-20260606-foot-CHART2-FOOTQ-VIEWER PHASE1 시안 캡처 — 정적 HTML → PNG (throwaway, prod 무관)
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const dir = dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });

for (const [file, w] of [['mockup_trigger.html', 640], ['mockup_document.html', 900]]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.goto('file://' + join(dir, file), { waitUntil: 'networkidle' });
  const out = join(dir, file.replace('.html', '.png'));
  await page.screenshot({ path: out, fullPage: true });
  console.log('saved', out);
}

await browser.close();
