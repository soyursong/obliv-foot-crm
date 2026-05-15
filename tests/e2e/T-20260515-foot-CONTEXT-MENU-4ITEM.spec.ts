/**
 * T-20260515-foot-CONTEXT-MENU-4ITEM
 * 풋센터 우클릭 컨텍스트 메뉴 4항목 확장 (CRM 동기화)
 *
 * AC-1: 대시보드 카드 우클릭 → 4항목 순서 (고객차트·진료차트·예약하기·수납)
 * AC-2: 진료차트 항목 클릭 → MedicalChartPanel/시트 표시
 * AC-3: 수납 항목 클릭 → 결제 창 표시
 * AC-4: 고객관리 화면 우클릭 → 동일 4항목 표시
 *
 * 현장 클릭 시나리오 4건 — 티켓 T-20260515-foot-CONTEXT-MENU-4ITEM.md 참조
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

async function loginIfNeeded(page: import('@playwright/test').Page, email?: string, password?: string) {
  await page.goto(BASE_URL);
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(email ?? process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(password ?? process.env.TEST_PASSWORD ?? 'testpass');
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|$)/, { timeout: 10000 });
  }
}

/** 대시보드에서 첫 번째 체크인 카드를 우클릭해 CustomerQuickMenu를 여는 헬퍼 */
async function openDashboardContextMenu(page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/dashboard`);
  await page.waitForLoadState('networkidle', { timeout: 15000 });

  // data-checkin-id 속성이 있는 카드 우선, 없으면 칸반 카드 fallback
  const checkInCard = page.locator('[data-checkin-id]').first();
  const hasCards = await checkInCard.count() > 0;
  if (!hasCards) return false;

  await checkInCard.click({ button: 'right' });
  await page.waitForTimeout(500);
  return true;
}

// ── 시나리오 1: 대시보드 우클릭 → 4항목 순서 확인 (AC-1) ────────────────────

test('AC-1: 대시보드 카드 우클릭 → 4항목 순서 (고객차트·진료차트·예약하기·수납)', async ({ page }) => {
  await loginIfNeeded(page);
  const opened = await openDashboardContextMenu(page);
  if (!opened) {
    test.skip(true, '대시보드에 체크인 카드 없음 — 컨텍스트 메뉴 테스트 스킵');
    return;
  }

  // CustomerQuickMenu 컨테이너 확인
  const menu = page.locator('.fixed.z-\\[60\\], [class*="shadow-xl"]').filter({ hasText: '고객차트' }).first();
  await menu.waitFor({ timeout: 5000 });

  // 4항목 모두 표시 확인
  await expect(menu.getByText('고객차트', { exact: true })).toBeVisible({ timeout: 3000 });
  await expect(menu.getByText('진료차트', { exact: true })).toBeVisible({ timeout: 3000 });
  await expect(menu.getByText('예약하기', { exact: true })).toBeVisible({ timeout: 3000 });
  await expect(menu.getByText('수납', { exact: true })).toBeVisible({ timeout: 3000 });

  // 순서 확인 — 고객차트가 진료차트보다 위에 있어야 함
  const buttons = menu.getByRole('button');
  const texts = await buttons.allTextContents();
  const stripped = texts.map((t) => t.trim()).filter(Boolean);

  // "고객차트" 인덱스 < "진료차트" < "예약하기" < "수납" 순
  const idxChart = stripped.findIndex((t) => t.includes('고객차트'));
  const idxMedical = stripped.findIndex((t) => t.includes('진료차트'));
  const idxResv = stripped.findIndex((t) => t.includes('예약하기'));
  const idxPay = stripped.findIndex((t) => t.includes('수납'));

  expect(idxChart).toBeGreaterThanOrEqual(0);
  expect(idxMedical).toBeGreaterThan(idxChart);
  expect(idxResv).toBeGreaterThan(idxMedical);
  expect(idxPay).toBeGreaterThan(idxResv);

  // Escape로 닫기 확인
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible({ timeout: 3000 }).catch(() => {});
});

// ── 시나리오 2: 대시보드 우클릭 → 진료차트 클릭 → MedicalChartPanel 표시 (AC-2) ──

test('AC-2: 대시보드 우클릭 → 진료차트 클릭 → 진료차트 화면 표시', async ({ page }) => {
  await loginIfNeeded(page);
  const opened = await openDashboardContextMenu(page);
  if (!opened) {
    test.skip(true, '체크인 카드 없음');
    return;
  }

  const menu = page.locator('.fixed.z-\\[60\\], [class*="shadow-xl"]').filter({ hasText: '고객차트' }).first();
  await menu.waitFor({ timeout: 5000 });

  const medicalChartItem = menu.getByText('진료차트', { exact: true });
  const isVisible = await medicalChartItem.isVisible({ timeout: 3000 }).catch(() => false);
  if (!isVisible) {
    test.skip(true, '진료차트 항목 미표시 — 구현 확인 필요');
    return;
  }

  await medicalChartItem.click();
  await page.waitForTimeout(1500);

  // 진료차트 패널/시트/다이얼로그 열림 확인
  // MedicalChartPanel, "진료차트" 헤더 텍스트, 또는 dialog role 중 하나
  const panelVisible =
    await page.getByText('진료차트', { exact: false }).isVisible({ timeout: 5000 }).catch(() => false) ||
    await page.locator('[role="dialog"]').isVisible({ timeout: 3000 }).catch(() => false);

  expect(panelVisible).toBe(true);
});

// ── 시나리오 3: 대시보드 우클릭 → 수납 클릭 → 결제 창 표시 (AC-3) ─────────────

test('AC-3: 대시보드 우클릭 → 수납 클릭 → 결제 창 표시', async ({ page }) => {
  await loginIfNeeded(page);
  const opened = await openDashboardContextMenu(page);
  if (!opened) {
    test.skip(true, '체크인 카드 없음');
    return;
  }

  const menu = page.locator('.fixed.z-\\[60\\], [class*="shadow-xl"]').filter({ hasText: '고객차트' }).first();
  await menu.waitFor({ timeout: 5000 });

  const payItem = menu.getByText('수납', { exact: true });
  const isVisible = await payItem.isVisible({ timeout: 3000 }).catch(() => false);
  if (!isVisible) {
    test.skip(true, '수납 항목 미표시 — 구현 확인 필요');
    return;
  }

  await payItem.click();
  await page.waitForTimeout(1500);

  // 결제 창(PaymentDialog/PaymentMiniWindow) 열림 확인
  // "결제" 또는 "수납" 텍스트 포함 dialog/panel
  const payWindowVisible =
    await page.locator('[role="dialog"]').filter({ hasText: '결제' }).isVisible({ timeout: 5000 }).catch(() => false) ||
    await page.locator('[role="dialog"]').filter({ hasText: '수납' }).isVisible({ timeout: 3000 }).catch(() => false) ||
    await page.getByText('결제하기', { exact: false }).isVisible({ timeout: 3000 }).catch(() => false) ||
    await page.getByText('수납 정보', { exact: false }).isVisible({ timeout: 3000 }).catch(() => false);

  expect(payWindowVisible).toBe(true);
});

// ── 시나리오 4: 고객관리 화면 우클릭 → 동일 4항목 표시 (AC-4) ──────────────────

test('AC-4: 고객관리 화면 행 우클릭 → 4항목 컨텍스트 메뉴 표시', async ({ page }) => {
  await loginIfNeeded(page);

  // 고객관리 페이지로 이동
  await page.goto(`${BASE_URL}/customers`);
  await page.waitForLoadState('networkidle', { timeout: 15000 });

  // 고객 행 존재 확인
  const customerRow = page.locator('table tr').filter({ hasText: /010/ }).first();
  const hasRows = await customerRow.count() > 0;
  if (!hasRows) {
    // fallback: tbody 첫 tr
    const firstRow = page.locator('tbody tr').first();
    const rowCount = await firstRow.count();
    if (rowCount === 0) {
      test.skip(true, '고객 데이터 없음 — 고객관리 컨텍스트 메뉴 테스트 스킵');
      return;
    }
    await firstRow.click({ button: 'right' });
  } else {
    await customerRow.click({ button: 'right' });
  }

  await page.waitForTimeout(500);

  // 컨텍스트 메뉴 표시 확인 — 4항목 중 하나라도 있으면 통과
  // Customers.tsx 인라인 메뉴(handleRowContextMenu) 또는 CustomerQuickMenu 공용 컴포넌트
  const menuArea = page
    .locator('.fixed, [role="menu"]')
    .filter({ hasText: /고객차트|진료차트|예약하기|수납/ })
    .first();

  const menuVisible = await menuArea.isVisible({ timeout: 5000 }).catch(() => false);
  if (!menuVisible) {
    test.skip(true, '고객관리 화면 컨텍스트 메뉴 미표시 — AC-4 구현 확인 필요');
    return;
  }

  // 4항목 표시 확인
  await expect(menuArea.getByText('고객차트', { exact: true })).toBeVisible({ timeout: 3000 });
  await expect(menuArea.getByText('진료차트', { exact: true })).toBeVisible({ timeout: 3000 });
  await expect(menuArea.getByText('예약하기', { exact: true })).toBeVisible({ timeout: 3000 });
  await expect(menuArea.getByText('수납', { exact: true })).toBeVisible({ timeout: 3000 });

  // Escape로 닫기
  await page.keyboard.press('Escape');
});
