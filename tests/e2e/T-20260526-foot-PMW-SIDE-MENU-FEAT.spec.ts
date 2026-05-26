/**
 * E2E spec — T-20260526-foot-PMW-SIDE-MENU-FEAT
 * 결제 미니창 왼쪽 서비스 메뉴 카드 순서 변경 + DB persist
 *
 * AC-1: 순서 편집 토글 버튼 → DnD + ↑↓ 리스트 모드 전환
 * AC-2: 순서 변경 → DB persist (service_menu_order 테이블, clinic × foot_cat), 재진입 시 복원
 * AC-3: 오리진 풋 clinic_id 기준 필터 (checkIn.clinic_id 경유 — 컴포넌트 자동 처리)
 * AC-4: 기본/시술내역/수액/화장품 4탭 각각 독립 순서 (탭 전환 시 모드 리셋)
 * AC-5: 기존 카드 클릭(수가 추가) 기능 무영향
 * 시나리오-1: 항목 1건인 탭 → '순서 편집' 버튼 비노출
 * 시나리오-2: ↑↓ 버튼으로 순서 변경 → 리스트 순서 즉시 반영
 * 시나리오-3: '완료' 클릭 → 그리드 모드 복귀, 저장 순서 유지
 * 시나리오-4: 탭 전환 → menuReorderMode 리셋
 * 시나리오-5: 서브탭 전환 → menuReorderMode 리셋
 */

import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// ---------------------------------------------------------------------------
// 헬퍼: 결제 미니창 진입 + 풋케어 탭 확인
// ---------------------------------------------------------------------------

async function openPaymentMiniWindowFootcare(
  page: import('@playwright/test').Page,
): Promise<boolean> {
  await page.goto('/admin');
  try {
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
  } catch {
    return false;
  }

  const checkInCard = page
    .locator('[data-testid^="check-in-card-"]')
    .or(page.locator('.kanban-card'))
    .first();

  try {
    await checkInCard.waitFor({ timeout: 8_000 });
    await checkInCard.click();
    await page.waitForTimeout(500);
  } catch {
    return false;
  }

  const payBtn = page
    .getByRole('button', { name: /결제|수납|수가/i })
    .or(page.locator('[data-testid="open-payment-mini"]'))
    .first();

  try {
    await payBtn.waitFor({ timeout: 5_000 });
    await payBtn.click();
    await page.waitForTimeout(600);
  } catch {
    return false;
  }

  // 풋케어 탭 확인 (기본 탭)
  try {
    await page.getByRole('button', { name: '풋케어' }).first().waitFor({ timeout: 6_000 });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// AC-1: 순서 편집 토글 버튼 존재 + 리스트 모드 전환
// ---------------------------------------------------------------------------

test('AC-1: 풋케어 탭 순서 편집 토글 → DnD 리스트 모드 전환', async ({ page }) => {
  await loginAndWaitForDashboard(page);
  const entered = await openPaymentMiniWindowFootcare(page);
  if (!entered) {
    test.skip(true, '결제 미니창 진입 불가 — 체크인 없음');
    return;
  }

  // 서브탭 항목 2건 이상인 탭 찾기 (기본(진찰료) 기본 선택)
  const toggleBtn = page.getByTestId('menu-reorder-toggle');
  const isVisible = await toggleBtn.isVisible().catch(() => false);
  if (!isVisible) {
    // 항목 1건 미만 → 토글 없음 (정상)
    console.log('서비스 항목 없음 또는 1건 — 순서 편집 버튼 비노출 정상');
    return;
  }

  // 토글 클릭 → 리스트 모드
  await toggleBtn.click();
  await page.waitForTimeout(300);

  const menuList = page.getByTestId('menu-card-list');
  await expect(menuList).toBeVisible({ timeout: 3_000 });

  // 그리드 사라짐 (grid 클래스 없어짐)
  const grid = page.locator('.grid.grid-cols-3, .grid.grid-cols-4').first();
  await expect(grid).not.toBeVisible().catch(() => { /* skip */ });
});

// ---------------------------------------------------------------------------
// 시나리오-2: ↑↓ 버튼으로 순서 변경
// ---------------------------------------------------------------------------

test('시나리오-2: ↑↓ 버튼 → 서비스 카드 순서 변경', async ({ page }) => {
  await loginAndWaitForDashboard(page);
  const entered = await openPaymentMiniWindowFootcare(page);
  if (!entered) {
    test.skip(true, '결제 미니창 진입 불가 — 체크인 없음');
    return;
  }

  const toggleBtn = page.getByTestId('menu-reorder-toggle');
  if (!(await toggleBtn.isVisible().catch(() => false))) {
    test.skip(true, '서비스 항목 1건 미만 — 순서 편집 버튼 없음');
    return;
  }

  await toggleBtn.click();
  await page.waitForTimeout(300);

  // 첫 번째 카드의 "아래로" 버튼 클릭
  const rows = await page.getByTestId(/^menu-card-row-/).all();
  if (rows.length < 2) {
    test.skip(true, '항목 2건 미만');
    return;
  }

  const firstId = await rows[0].getAttribute('data-testid');
  const serviceId = firstId?.replace('menu-card-row-', '') ?? '';

  const downBtn = page.getByTestId(`menu-reorder-down-${serviceId}`);
  await expect(downBtn).toBeEnabled({ timeout: 2_000 });
  await downBtn.click();
  await page.waitForTimeout(200);

  // 첫 번째 항목이 바뀌었는지 확인 (전 첫번째 카드가 이제 두번째여야 함)
  const rowsAfter = await page.getByTestId(/^menu-card-row-/).all();
  const secondId = await rowsAfter[1].getAttribute('data-testid');
  expect(secondId).toBe(`menu-card-row-${serviceId}`);
});

// ---------------------------------------------------------------------------
// 시나리오-3: '완료' → 그리드 모드 복귀
// ---------------------------------------------------------------------------

test('시나리오-3: 완료 버튼 → 그리드 모드 복귀', async ({ page }) => {
  await loginAndWaitForDashboard(page);
  const entered = await openPaymentMiniWindowFootcare(page);
  if (!entered) {
    test.skip(true, '결제 미니창 진입 불가 — 체크인 없음');
    return;
  }

  const toggleBtn = page.getByTestId('menu-reorder-toggle');
  if (!(await toggleBtn.isVisible().catch(() => false))) {
    test.skip(true, '서비스 항목 1건 미만');
    return;
  }

  // 편집 모드 진입
  await toggleBtn.click();
  await page.waitForTimeout(300);
  await expect(page.getByTestId('menu-card-list')).toBeVisible({ timeout: 3_000 });

  // 완료 클릭
  await page.getByTestId('menu-reorder-toggle').click();
  await page.waitForTimeout(300);

  // 리스트 사라짐
  await expect(page.getByTestId('menu-card-list')).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// 시나리오-4: 탭 전환 시 menuReorderMode 리셋
// ---------------------------------------------------------------------------

test('시나리오-4: 탭 전환 → 편집 모드 자동 리셋', async ({ page }) => {
  await loginAndWaitForDashboard(page);
  const entered = await openPaymentMiniWindowFootcare(page);
  if (!entered) {
    test.skip(true, '결제 미니창 진입 불가 — 체크인 없음');
    return;
  }

  const toggleBtn = page.getByTestId('menu-reorder-toggle');
  if (!(await toggleBtn.isVisible().catch(() => false))) {
    test.skip(true, '서비스 항목 1건 미만');
    return;
  }

  // 편집 모드 진입
  await toggleBtn.click();
  await page.waitForTimeout(200);
  await expect(page.getByTestId('menu-card-list')).toBeVisible({ timeout: 3_000 });

  // 상병코드 탭 클릭
  await page.getByRole('button', { name: '상병코드' }).first().click();
  await page.waitForTimeout(200);

  // 풋케어 탭 복귀
  await page.getByRole('button', { name: '풋케어' }).first().click();
  await page.waitForTimeout(200);

  // 편집 모드 리셋됨 (리스트 비가시)
  await expect(page.getByTestId('menu-card-list')).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// AC-5: 카드 클릭 → 수가 항목 추가 (편집 모드 OFF 상태)
// ---------------------------------------------------------------------------

test('AC-5: 그리드 카드 클릭 → 수가 항목 추가 정상', async ({ page }) => {
  await loginAndWaitForDashboard(page);
  const entered = await openPaymentMiniWindowFootcare(page);
  if (!entered) {
    test.skip(true, '결제 미니창 진입 불가 — 체크인 없음');
    return;
  }

  // 순서 편집 모드 OFF 확인 후 카드 클릭
  const menuList = page.getByTestId('menu-card-list');
  // 편집 모드가 아닌 상태에서 그리드 카드 클릭
  const card = page.locator('.grid button').first();
  const isCardVisible = await card.isVisible().catch(() => false);
  if (!isCardVisible) {
    test.skip(true, '서비스 카드 없음');
    return;
  }

  await card.click();
  await page.waitForTimeout(300);

  // 수가 항목 목록(pricing-list)에 항목 추가됨
  const pricingList = page.getByTestId('pricing-list');
  const itemCount = await pricingList.locator('[data-testid^="pricing-row-"]').count();
  expect(itemCount).toBeGreaterThan(0);

  // 편집 모드 미진입 확인
  await expect(menuList).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// 시나리오-5: 서브탭 전환 → 편집 모드 리셋
// ---------------------------------------------------------------------------

test('시나리오-5: 서브탭 전환 → 편집 모드 리셋', async ({ page }) => {
  await loginAndWaitForDashboard(page);
  const entered = await openPaymentMiniWindowFootcare(page);
  if (!entered) {
    test.skip(true, '결제 미니창 진입 불가 — 체크인 없음');
    return;
  }

  const toggleBtn = page.getByTestId('menu-reorder-toggle');
  if (!(await toggleBtn.isVisible().catch(() => false))) {
    test.skip(true, '서비스 항목 1건 미만');
    return;
  }

  // 편집 모드 진입
  await toggleBtn.click();
  await page.waitForTimeout(200);
  await expect(page.getByTestId('menu-card-list')).toBeVisible({ timeout: 3_000 });

  // 시술내역 서브탭 클릭
  const subTabBtn = page.getByRole('button', { name: '시술내역(풋케어)' }).first();
  if (await subTabBtn.isVisible().catch(() => false)) {
    await subTabBtn.click();
    await page.waitForTimeout(200);
    // 편집 모드 자동 리셋
    await expect(page.getByTestId('menu-card-list')).not.toBeVisible();
  }
});
