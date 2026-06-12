/**
 * T-20260612-foot-PROGRESSPLAN-MIGRATION-NOTAPPLIED-HOTFIX — AC-3 browser render evidence.
 * 경과분석 플랜 탭(ProgressPlansTab)이 "로딩 실패" 없이 tier UI 렌더되는지 실브라우저 캡처.
 * dev 서버(8085)는 prod Supabase(rxlomoozakkjesdqjtvd)를 바라봄 → 실제 쿼리 경로 검증.
 */
import { chromium } from 'playwright';
import fs from 'fs';

const PORT = process.env.VITE_DEV_PORT ?? '8085';
const BASE = `http://localhost:${PORT}`;
const OUT = process.env.OUT_DIR;

// 로컬 auth state origin(8089→실행 포트) 재기록
const raw = JSON.parse(fs.readFileSync('.auth/user.json', 'utf8'));
for (const o of raw.origins ?? []) o.origin = BASE;
const storageState = raw;

const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`${BASE}/admin/clinic-management`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// 경과분석 플랜 탭 클릭
const tab = page.locator('[data-testid="tab-progress-plans"]');
await tab.waitFor({ state: 'visible', timeout: 15000 });
await tab.click();
await page.waitForTimeout(2500); // fetch 완료 대기

const bodyText = await page.locator('body').innerText();
const hasLoadFail = bodyText.includes('로딩 실패');
const hasTierUi = /경과분석 플랜 설정|체크포인트|회차/.test(bodyText);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
await page.screenshot({ path: `${OUT}/ac3_progress_plans_tab_${stamp}.png`, fullPage: true });

console.log(`BASE=${BASE}`);
console.log(`로딩 실패 toast 노출: ${hasLoadFail ? '❌ 발생(FAIL)' : '✅ 없음(PASS)'}`);
console.log(`tier UI 렌더: ${hasTierUi ? '✅' : '❌'}`);
console.log(`console errors(${errors.length}): ${errors.slice(0,5).join(' | ') || 'none'}`);
console.log(`screenshot: ${OUT}/ac3_progress_plans_tab_${stamp}.png`);

await browser.close();
process.exit(hasLoadFail ? 1 : 0);
