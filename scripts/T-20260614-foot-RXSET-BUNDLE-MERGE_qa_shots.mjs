/**
 * T-20260614-foot-RXSET-BUNDLE-MERGE — QA 화면 증빙 캡처 (supervisor FIX-REQUEST 대응)
 *
 * 검증 3항:
 *  (1) 묶음처방(PrescriptionSetsTab, ?tab=prescriptions) 화면에 "약" 폴더 + 단독약 19세트 그룹 노출
 *  (2) 묶음처방 탭 잔존 + 처방세트(drug_folders) 탭 잔존 — 탭 삭제 안 됨
 *  (3) "약" 폴더 항목명 = 약 이름(예: 에스로반연고(무피로신)10g) — 분류/투여경로가 이름칸에 뜨면 FAIL
 *
 * 실행: 로컬 dev(8089, VITE_DISABLE_AUTH_LOCK=1) + .auth/user.json(prod Supabase 세션).
 *   데이터는 foot prod(rxlomoozakkjesdqjtvd), FE는 main 배포본과 동일 커밋.
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH = path.join(__dirname, '..', '.auth', 'user.json');
const OUT = process.env.SHOT_DIR ||
  path.join(process.env.HOME, 'claude-sync/memory/_handoff/qa_screenshots/T-20260614-foot-RXSET-BUNDLE-MERGE');
const BASE = process.env.BASE_URL || 'http://localhost:8089';

const browser = await chromium.launch();
const ctx = await browser.newContext({
  storageState: AUTH,
  viewport: { width: 1280, height: 1400 },
});
const page = await ctx.newPage();
const log = (...a) => console.log('[qa-shots]', ...a);

async function shot(name) {
  const p = path.join(OUT, name);
  await page.screenshot({ path: p, fullPage: true });
  log('saved', p);
}

// 1) 묶음처방 탭 (PrescriptionSetsTab) — folder='약' 그룹 렌더
await page.goto(`${BASE}/admin/clinic-management?tab=prescriptions`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
// 탭 트리거 존재 확인
const tabBundle = page.getByTestId('tab-prescription-sets-legacy');
const tabRxSet = page.getByTestId('tab-drug-folders');
log('묶음처방 탭 존재:', await tabBundle.count(), '| 처방세트 탭 존재:', await tabRxSet.count());
await tabBundle.click().catch(() => {});
await page.waitForTimeout(1500);

// 폴더 그룹/이름/카운트 추출
const folderGroups = await page.getByTestId('rx-set-folder-name').allTextContents();
const folderCounts = await page.evaluate(() => {
  const groups = [...document.querySelectorAll('[data-testid="rx-set-folder-group"]')];
  return groups.map((g) => {
    const name = g.querySelector('[data-testid="rx-set-folder-name"]')?.textContent?.trim() ?? '(미분류)';
    const items = g.querySelectorAll('[data-testid="rx-set-item"]').length;
    return { name, items };
  });
});
log('폴더 그룹:', JSON.stringify(folderCounts));

// "약" 폴더 카드 제목(=set.name) 표본 추출 (issue#3: 약 이름 표시 여부)
const cardTitles = await page.evaluate(() => {
  const groups = [...document.querySelectorAll('[data-testid="rx-set-folder-group"]')];
  const yak = groups.find((g) => g.querySelector('[data-testid="rx-set-folder-name"]')?.textContent?.trim() === '약');
  if (!yak) return [];
  return [...yak.querySelectorAll('[data-testid="rx-set-item"]')].map((it) => {
    const title = it.querySelector('span')?.textContent?.trim() ?? '';
    return title;
  });
});
log('약 폴더 카드 제목 표본:', JSON.stringify(cardTitles.slice(0, 6)));
log('약 폴더 카드 수:', cardTitles.length);
await shot('01_bundle_tab_yak_folder.png');

// 2) 처방세트 탭(drug_folders) 화면 — 탭 잔존 확인용
await page.goto(`${BASE}/admin/clinic-management?tab=drug_folders`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await shot('02_rxset_tab_drug_folders.png');

// 3) 탭 바 전체 (탭 잔존 증빙)
await page.goto(`${BASE}/admin/clinic-management?tab=prescriptions`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const tabBar = page.locator('[role="tablist"]').first();
await tabBar.screenshot({ path: path.join(OUT, '03_tab_bar.png') }).catch(() => {});
log('탭바 캡처 시도 완료');

const bundleCnt = await tabBundle.count();
const rxsetCnt = await tabRxSet.count();

await browser.close();

// 결과 요약 (JSON)
console.log('=== VERIFY SUMMARY ===');
console.log(JSON.stringify({
  folderGroups: folderCounts,
  yakCardCount: cardTitles.length,
  yakCardTitlesSample: cardTitles.slice(0, 6),
  tabsPresent: { bundle: bundleCnt, rxset: rxsetCnt },
}, null, 2));
