/**
 * E2E spec — T-20260613-foot-CUSTLIST-MULTISELECT-EXPORT
 *
 * 고객관리(/admin/customers) 고객 다중선택 + 리스트 내보내기(CSV).
 * 김주연 총괄 요청. 기존 5FIX AC4(xlsx)를 supersede → 1차 CSV(무의존) + PII 게이팅.
 *
 * AC:
 *  AC-1: 행별 체크박스 + 전체선택 동작 (선택 카운트 라벨 노출)
 *  AC-2: 선택 후 [내보내기] → CSV 파일(.csv) 다운로드 (BOM·UTF-8)
 *  AC-3: 선택 0건 → [내보내기]는 '필터된 전체'를 재조회해 CSV 다운로드 (현재 페이지 한정 아님)
 *  AC-4: PII 게이팅 — admin/manager만 내보내기 버튼 노출(테스트 계정=admin → 노출 확인).
 *        ※ rrn(주민번호)은 어떤 권한이든 CSV 컬럼에서 영구 제외 → customerCsv 유닛(헤더)에서 보장.
 *  AC-5(회귀): 핵심 화면 무결 — 행/체크박스/우클릭 메뉴 정상.
 *
 * 비고: 비-admin(staff) 음성 케이스는 역할 전환 로그인 인프라 부재로 본 E2E 미포함 →
 *       권한 게이팅은 permissions.ts(customer_export=['admin','manager']) + 핸들러 이중가드로 강제.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  await page.goto(BASE_URL);
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })());
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|admin|$)/, { timeout: 10000 });
  }
}

async function gotoCustomers(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto(`${BASE_URL}/admin/customers`);
  await page.waitForLoadState('networkidle', { timeout: 15000 });
  const row = page.locator('tbody tr').first();
  return await row.isVisible({ timeout: 5000 }).catch(() => false);
}

// ── AC-1: 행 체크박스 + 전체선택 + 카운트 라벨 ───────────────────────────────
test('AC-1: 행 체크박스 선택 → 내보내기 라벨에 선택 카운트', async ({ page }) => {
  await loginIfNeeded(page);
  if (!(await gotoCustomers(page))) { test.skip(true, '고객 행 없음 — 스킵'); return; }

  const firstCheck = page.getByTestId('cust-row-check').first();
  await firstCheck.check();
  await expect(firstCheck).toBeChecked();

  const exportBtn = page.getByTestId('cust-export-btn');
  await expect(exportBtn).toContainText('내보내기');
  await expect(exportBtn).toContainText('(1)'); // 선택 1건 카운트
});

// ── AC-2: 선택 후 [내보내기] → CSV 다운로드 ──────────────────────────────────
test('AC-2: 선택 후 [내보내기] → CSV(.csv) 파일 다운로드', async ({ page }) => {
  await loginIfNeeded(page);
  if (!(await gotoCustomers(page))) { test.skip(true, '고객 행 없음 — 스킵'); return; }

  await page.getByTestId('cust-row-check').first().check();
  const exportBtn = page.getByTestId('cust-export-btn');

  const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
  await exportBtn.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/고객목록_\d{8}\.csv$/);
});

// ── AC-3: 선택 0건 → 필터된 전체 재조회 후 CSV ───────────────────────────────
test('AC-3: 미선택 [내보내기] → 필터 전체 재조회(range 0-) 후 CSV 다운로드', async ({ page }) => {
  await loginIfNeeded(page);

  // 선택 0건 export는 페이지네이션 없는 전체 재조회를 1회 발생시킴 → range 헤더 0부터 관찰.
  let sawFullRangeFetch = false;
  await page.route('**/rest/v1/customers*', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      const range = req.headers()['range'] ?? '';
      // 목록은 0-29(PAGE_SIZE). export 전체는 0-4999(EXPORT_MAX-1).
      if (range.startsWith('0-') && !range.startsWith('0-29')) sawFullRangeFetch = true;
    }
    await route.continue();
  });

  if (!(await gotoCustomers(page))) { test.skip(true, '고객 행 없음 — 스킵'); return; }

  // 선택하지 않은 상태로 바로 내보내기
  const exportBtn = page.getByTestId('cust-export-btn');
  await expect(exportBtn).toBeEnabled();
  await expect(exportBtn).not.toContainText('('); // 선택 카운트 없음

  const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
  await exportBtn.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/고객목록_\d{8}\.csv$/);
  expect(sawFullRangeFetch).toBe(true); // 현재 페이지가 아닌 '전체' 재조회 확인
});

// ── AC-4: PII 게이팅 — admin 계정에서 내보내기 버튼 노출 ──────────────────────
test('AC-4: admin 계정 → 내보내기 버튼 노출(PII 게이팅 통과)', async ({ page }) => {
  await loginIfNeeded(page);
  if (!(await gotoCustomers(page))) { test.skip(true, '고객 행 없음 — 스킵'); return; }
  await expect(page.getByTestId('cust-export-btn')).toBeVisible();
});

// ── AC-5(회귀): 핵심 화면 무결 ───────────────────────────────────────────────
test('AC-5(회귀): 체크박스·전체선택·우클릭 메뉴 정상', async ({ page }) => {
  await loginIfNeeded(page);
  if (!(await gotoCustomers(page))) { test.skip(true, '고객 행 없음 — 스킵'); return; }

  const selectAll = page.getByTestId('cust-select-all');
  await selectAll.check();
  const rowChecks = page.getByTestId('cust-row-check');
  const count = await rowChecks.count();
  for (let i = 0; i < count; i++) await expect(rowChecks.nth(i)).toBeChecked();
  await selectAll.uncheck();

  await page.locator('tbody tr').first().click({ button: 'right' });
  const menu = page.locator('.fixed.z-\\[60\\], [class*="shadow-xl"]').filter({ hasText: '고객차트' }).first();
  await expect(menu).toBeVisible({ timeout: 5000 });
});
