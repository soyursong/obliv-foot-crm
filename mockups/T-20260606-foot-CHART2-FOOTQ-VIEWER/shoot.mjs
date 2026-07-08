import { chromium } from 'playwright-core';
import { fileURLToPath } from 'url';
import path from 'path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const htmlUrl = 'file://' + path.join(dir, 'healthq-image-mockup.html');

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
await page.setViewportSize({ width: 800, height: 1200 });
await page.goto(htmlUrl, { waitUntil: 'networkidle' });
await page.screenshot({
  path: path.join(dir, 'healthq-image-mockup.png'),
  fullPage: true,
});
await browser.close();
console.log('PNG written: healthq-image-mockup.png');
