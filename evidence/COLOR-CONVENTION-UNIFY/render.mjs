import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
await page.goto('file://' + path.join(dir, 'preview.html'));
await page.setViewportSize({ width: 1480, height: 860 });
await page.waitForTimeout(300);
const el = await page.$('body');
await el.screenshot({ path: path.join(dir, 'color-convention-candidates.png') });
console.log('rendered color-convention-candidates.png');
await browser.close();
