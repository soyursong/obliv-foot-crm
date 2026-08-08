import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const html = 'file://' + path.join(dir, 'mockup-field-clean.html');
const out = path.join(dir, 'PAYMINI-RX-QTY-field-clean.png');

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
await page.setViewportSize({ width: 800, height: 640 });
await page.goto(html, { waitUntil: 'networkidle' });
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('rendered:', out);
