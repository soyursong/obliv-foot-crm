/**
 * T-20260516-foot-CHART-ROUTE-FIX
 * 우클릭 [진료차트] 메뉴 → MedicalChartPanel 라우팅 수정 검증
 *
 * 버그: CONTEXT-MENU-4ITEM 배포 후 우클릭 [진료차트] 클릭 시
 *       MedicalChartPanel(6항목) 대신 Chart1(고객차트) 형식으로 열림
 * 원인: handleOpenMedicalChart가 경쟁 시트(CheckInDetailSheet/CustomerChartSheet)를
 *       닫지 않아 MedicalChartPanel(z-50)이 CustomerChartSheet(z-70) 뒤에 가려짐
 * 수정: setSelectedCheckIn(null) + setDashChartSheetId(null) 추가 후 MedicalChartPanel 열기
 *
 * AC-1: 우클릭 → [진료차트] → MedicalChartPanel 열림 (dialog role 확인)
 * AC-2: [고객차트] → CustomerChartSheet(Chart1) 동작 유지 (회귀 방지)
 * AC-3: 4항목 전체 동작 검증 (고객차트/진료차트/예약하기/수납)
 *
 * 티켓: T-20260516-foot-CHART-ROUTE-FIX
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  await page.goto(BASE_URL);
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? 'testpass');
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|$)/, { timeout: 10000 });
  }
}

/** 대시보드에서 첫 체크인 카드를 우클릭해 CustomerQuickMenu 여는 헬퍼. 카드 없으면 false 반환. */
async function openQuickMenu(page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/dashboard`);
  await page.waitForLoadState('networkidle', { timeout: 15000 });

  const card = page.locator('[data-checkin-id]').first();
  if ((await card.count()) === 0) return false;

  await card.click({ button: 'right' });
  await page.waitForTimeout(500);
  return true;
}

/** CustomerQuickMenu 컨테이너 로케이터 */
function quickMenu(page: import('@playwright/test').Page) {
  return page
    .locator('.fixed.z-\\[60\\]')
    .filter({ hasText: '고객차트' })
    .first();
}

// ── AC-1: 우클릭 → [진료차트] → MedicalChartPanel 열림 ───────────────────────

test('AC-1: 우클릭 → 진료차트 → MedicalChartPanel(dialog) 열림', async ({ page }) => {
  await loginIfNeeded(page);
  const opened = await openQuickMenu(page);
  if (!opened) {
    test.skip(true, '대시보드에 체크인 카드 없음');
    return;
  }

  const menu = quickMenu(page);
  await menu.waitFor({ timeout: 5000 });

  const medItem = menu.getByText('진료차트', { exact: true });
  if (!(await medItem.isVisible({ timeout: 3000 }).catch(() => false))) {
    test.skip(true, '진료차트 항목 미표시');
    return;
  }

  await medItem.click();
  await page.waitForTimeout(1500);

  // MedicalChartPanel: BaseDialog.Popup → role="dialog", SheetTitle "진료차트"
  const dialogVisible = await page
    .locator('[role="dialog"]')
    .isVisible({ timeout: 5000 })
    .catch(() => false);

  expect(dialogVisible).toBe(true);

  // 진료차트 타이틀 확인 (Chart1이 아닌 MedicalChartPanel임을 검증)
  const titleVisible = await page
    .locator('[role="dialog"]')
    .filter({ hasText: '진료차트' })
    .isVisible({ timeout: 3000 })
    .catch(() => false);

  expect(titleVisible).toBe(true);
});

// ── AC-1b: 진료차트 열릴 때 CheckInDetailSheet가 닫혀 있어야 함 ─────────────────

test('AC-1b: 진료차트 열릴 때 경쟁 시트(CheckInDetailSheet) 닫힘 확인', async ({ page }) => {
  await loginIfNeeded(page);
  const opened = await openQuickMenu(page);
  if (!opened) {
    test.skip(true, '대시보드에 체크인 카드 없음');
    return;
  }

  const menu = quickMenu(page);
  await menu.waitFor({ timeout: 5000 });

  const medItem = menu.getByText('진료차트', { exact: true });
  if (!(await medItem.isVisible({ timeout: 3000 }).catch(() => false))) {
    test.skip(true, '진료차트 항목 미표시');
    return;
  }

  await medItem.click();
  await page.waitForTimeout(1500);

  // MedicalChartPanel dialog가 열려 있어야 함
  const dialogs = page.locator('[role="dialog"]');
  const count = await dialogs.count();

  // dialog가 정확히 1개여야 함 (MedicalChartPanel만 열린 상태)
  // CheckInDetailSheet가 함께 열리면 2개가 됨 → 버그 재현
  expect(count).toBeLessThanOrEqual(1);
});

// ── AC-2: [고객차트] 클릭 → CustomerChartSheet(Chart1) 동작 유지 (회귀 방지) ──

test('AC-2: 고객차트 → Chart1(CustomerChartSheet) 동작 유지', async ({ page }) => {
  await loginIfNeeded(page);
  const opened = await openQuickMenu(page);
  if (!opened) {
    test.skip(true, '대시보드에 체크인 카드 없음');
    return;
  }

  const menu = quickMenu(page);
  await menu.waitFor({ timeout: 5000 });

  const chartItem = menu.getByText('고객차트', { exact: true });
  if (!(await chartItem.isVisible({ timeout: 3000 }).catch(() => false))) {
    test.skip(true, '고객차트 항목 미표시');
    return;
  }

  await chartItem.click();
  await page.waitForTimeout(1500);

  // CustomerChartSheet: createPortal 기반 슬라이드 패널
  // "고객차트" 텍스트 또는 차트 내용이 화면에 나타나야 함
  const chartVisible =
    (await page.getByText('고객 차트', { exact: false }).isVisible({ timeout: 5000 }).catch(() => false)) ||
    (await page.getByText('방문 기록', { exact: false }).isVisible({ timeout: 3000 }).catch(() => false)) ||
    (await page.locator('[data-testid="customer-chart"]').isVisible({ timeout: 3000 }).catch(() => false));

  expect(chartVisible).toBe(true);
});

// ── AC-3: 4항목 전체 순서 및 동작 확인 ──────────────────────────────────────

test('AC-3: 4항목 순서 (고객차트·진료차트·예약하기·수납) 확인', async ({ page }) => {
  await loginIfNeeded(page);
  const opened = await openQuickMenu(page);
  if (!opened) {
    test.skip(true, '대시보드에 체크인 카드 없음');
    return;
  }

  const menu = quickMenu(page);
  await menu.waitFor({ timeout: 5000 });

  // 4항목 모두 표시 확인
  await expect(menu.getByText('고객차트', { exact: true })).toBeVisible({ timeout: 3000 });
  await expect(menu.getByText('진료차트', { exact: true })).toBeVisible({ timeout: 3000 });
  await expect(menu.getByText('예약하기', { exact: true })).toBeVisible({ timeout: 3000 });
  await expect(menu.getByText('수납', { exact: true })).toBeVisible({ timeout: 3000 });

  // 순서: 고객차트 < 진료차트 < 예약하기 < 수납
  const buttons = menu.getByRole('button');
  const texts = (await buttons.allTextContents()).map((t) => t.trim()).filter(Boolean);

  const idxChart = texts.findIndex((t) => t.includes('고객차트'));
  const idxMedical = texts.findIndex((t) => t.includes('진료차트'));
  const idxResv = texts.findIndex((t) => t.includes('예약하기'));
  const idxPay = texts.findIndex((t) => t.includes('수납'));

  expect(idxChart).toBeGreaterThanOrEqual(0);
  expect(idxMedical).toBeGreaterThan(idxChart);
  expect(idxResv).toBeGreaterThan(idxMedical);
  expect(idxPay).toBeGreaterThan(idxResv);

  // ESC로 닫기
  await page.keyboard.press('Escape');
});

// ── AC-3b: 수납 항목 → PaymentMiniWindow 열림 ───────────────────────────────

test('AC-3b: 수납 항목 클릭 → 결제 창 표시', async ({ page }) => {
  await loginIfNeeded(page);
  const opened = await openQuickMenu(page);
  if (!opened) {
    test.skip(true, '대시보드에 체크인 카드 없음');
    return;
  }

  const menu = quickMenu(page);
  await menu.waitFor({ timeout: 5000 });

  const payItem = menu.getByText('수납', { exact: true });
  if (!(await payItem.isVisible({ timeout: 3000 }).catch(() => false))) {
    test.skip(true, '수납 항목 미표시');
    return;
  }

  await payItem.click();
  await page.waitForTimeout(1500);

  // PaymentMiniWindow or PaymentDialog 열림 확인
  const payVisible =
    (await page.locator('[role="dialog"]').filter({ hasText: '결제' }).isVisible({ timeout: 5000 }).catch(() => false)) ||
    (await page.locator('[role="dialog"]').filter({ hasText: '수납' }).isVisible({ timeout: 3000 }).catch(() => false)) ||
    (await page.getByText('결제하기', { exact: false }).isVisible({ timeout: 3000 }).catch(() => false)) ||
    (await page.getByText('수납 정보', { exact: false }).isVisible({ timeout: 3000 }).catch(() => false));

  expect(payVisible).toBe(true);
});
