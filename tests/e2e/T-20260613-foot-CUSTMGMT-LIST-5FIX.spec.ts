/**
 * T-20260613-foot-CUSTMGMT-LIST-5FIX · AC4 (리스트 다운로드)
 *
 * 고객관리(/admin/customers) 리스트에 행 체크박스 선택 + [내려받기](xlsx) 기능.
 *  - PHI 가드: export에 주민번호 평문 미포함(생년월일만). 라이브러리 xlsx 재사용(salesExport 패턴).
 *  - 선택 0건이면 현재 화면(필터·페이지) 리스트 전체 export(전수 무필터 덤프 아님).
 *
 * 본 spec 범위(planner NEW-TASK 기준):
 *  - AC4 = dev 신규 → UI/선택/다운로드 동선 검증.
 *  - AC1(생년월일 RRN 파생) = 선행 티켓 T-20260613-foot-CUSTLIST-BIRTHDATE-FROM-RRN(done)에서 검증됨 → 본 spec은 회귀 스모크만.
 *  - AC5(우클릭 stale) = 선행 티켓 T-20260613-foot-CUST-CONTEXTMENU-STALE(done)에서 검증됨.
 *  - AC2/AC3(담당자 컬럼·필터) = field-clarify 대기 → 본 spec 미포함.
 *
 * 검증:
 *  S1: 행 체크박스 선택 → [내려받기] 클릭 → 파일 다운로드 발생(.xlsx)
 *  S2: 전체선택 체크박스 토글 동작
 *  S3: 미선택 상태에서도 [내려받기]는 현재 목록 전체 대상으로 활성
 *  S4(회귀): 생년월일 컬럼 헤더/셀 렌더 + 우클릭 메뉴 정상(핵심 화면 회귀 0)
 */
import { test, expect } from '@playwright/test';

// playwright.config.ts baseURL=8089(전용 테스트 포트)와 정렬. webServer가 8089로 자동 기동.
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  await page.goto(BASE_URL);
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? 'testpass');
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

// ── S1: 행 선택 → 내려받기 → 파일 다운로드 ───────────────────────────────────
test('S1: 행 체크박스 선택 후 [내려받기] → xlsx 파일 다운로드', async ({ page }) => {
  await loginIfNeeded(page);
  const hasRows = await gotoCustomers(page);
  if (!hasRows) {
    test.skip(true, '고객 행 없음 — 스킵');
    return;
  }

  // 첫 행 체크박스 선택
  const firstCheck = page.getByTestId('cust-row-check').first();
  await firstCheck.check();
  await expect(firstCheck).toBeChecked();

  // 내려받기 버튼 라벨에 선택 카운트 노출
  const exportBtn = page.getByTestId('cust-export-btn');
  await expect(exportBtn).toContainText('내려받기');

  // 다운로드 이벤트 캡처
  const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
  await exportBtn.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/고객목록_\d{8}\.xlsx$/);
});

// ── S2: 전체선택 체크박스 토글 ───────────────────────────────────────────────
test('S2: 전체선택 체크박스 → 모든 행 선택/해제', async ({ page }) => {
  await loginIfNeeded(page);
  const hasRows = await gotoCustomers(page);
  if (!hasRows) {
    test.skip(true, '고객 행 없음 — 스킵');
    return;
  }

  const selectAll = page.getByTestId('cust-select-all');
  await selectAll.check();

  const rowChecks = page.getByTestId('cust-row-check');
  const count = await rowChecks.count();
  for (let i = 0; i < count; i++) {
    await expect(rowChecks.nth(i)).toBeChecked();
  }

  await selectAll.uncheck();
  for (let i = 0; i < count; i++) {
    await expect(rowChecks.nth(i)).not.toBeChecked();
  }
});

// ── S3: 미선택 상태에서도 내려받기 활성(현재 목록 전체) ──────────────────────
test('S3: 미선택 상태 [내려받기] → 현재 목록 전체 대상으로 다운로드', async ({ page }) => {
  await loginIfNeeded(page);
  const hasRows = await gotoCustomers(page);
  if (!hasRows) {
    test.skip(true, '고객 행 없음 — 스킵');
    return;
  }

  const exportBtn = page.getByTestId('cust-export-btn');
  await expect(exportBtn).toBeEnabled();

  const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
  await exportBtn.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/고객목록_\d{8}\.xlsx$/);
});

// ── S4(회귀): 핵심 화면 무결 — 생년월일 컬럼 + 우클릭 메뉴 ──────────────────
test('S4(회귀): 생년월일 컬럼 + 우클릭 컨텍스트 메뉴 정상', async ({ page }) => {
  await loginIfNeeded(page);
  const hasRows = await gotoCustomers(page);
  if (!hasRows) {
    test.skip(true, '고객 행 없음 — 스킵');
    return;
  }

  // 생년월일 헤더 존재 (AC1 회귀)
  await expect(page.locator('thead').getByText('생년월일')).toBeVisible();
  // 생년월일 셀 렌더 (서버 파생/휴리스틱/'-' 중 하나)
  await expect(page.getByTestId('cust-birthdate').first()).toBeVisible();

  // 우클릭 → 컨텍스트 메뉴(고객차트 항목) 정상 (AC5 회귀)
  await page.locator('tbody tr').first().click({ button: 'right' });
  const menu = page.locator('.fixed.z-\\[60\\], [class*="shadow-xl"]').filter({ hasText: '고객차트' }).first();
  await expect(menu).toBeVisible({ timeout: 5000 });
});
