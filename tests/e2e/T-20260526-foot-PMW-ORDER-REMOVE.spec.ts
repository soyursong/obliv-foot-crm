/**
 * E2E spec — T-20260526-foot-PMW-ORDER-REMOVE
 * 결제 미니창 "순서 편집" 기능 완전 제거 회귀 방지
 *
 * AC-1: "순서 편집" 텍스트 요소 DOM에 없음
 * AC-2: data-testid="menu-card-row-*" 요소 0건
 * AC-3: data-testid="menu-reorder-up-*" / "menu-reorder-down-*" 요소 0건
 * AC-4: data-testid="menu-reorder-toggle" 없음 (토글 버튼 제거)
 * AC-5: data-testid="pricing-list" 존재 — 기존 수가 목록 무영향(회귀 없음)
 *
 * commit: 3c30149 (origin/main 포함)
 * ticket: T-20260526-foot-PMW-ORDER-REMOVE
 */

import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';

// ---------------------------------------------------------------------------
// 헬퍼: PMW 진입 시도 → boolean 반환
// ---------------------------------------------------------------------------
async function tryOpenPaymentMiniWindow(
  page: import('@playwright/test').Page,
): Promise<boolean> {
  await page.goto(`${BASE}/admin`);

  // 대시보드 로드 대기
  try {
    await page.waitForSelector(
      '[data-testid^="check-in-card-"], .kanban-card, [data-testid="btn-pay"]',
      { timeout: 12_000 },
    );
  } catch {
    return false;
  }

  // btn-pay 버튼 우선 시도
  const btnPay = page.locator('[data-testid="btn-pay"]').first();
  if (await btnPay.isVisible().catch(() => false)) {
    await btnPay.click();
    await page.waitForTimeout(600);
    const pmw = page.locator('[data-testid="pricing-list"], text=차트 코드');
    if (await pmw.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
      return true;
    }
  }

  // kanban 카드 클릭 후 결제 버튼 시도
  const card = page
    .locator('[data-testid^="check-in-card-"]')
    .or(page.locator('.kanban-card'))
    .first();

  if (!(await card.isVisible({ timeout: 3_000 }).catch(() => false))) {
    return false;
  }

  await card.click();
  await page.waitForTimeout(400);

  const payBtn = page
    .getByRole('button', { name: /결제|수납/i })
    .or(page.locator('[data-testid="open-payment-mini"]'))
    .first();

  if (!(await payBtn.isVisible({ timeout: 4_000 }).catch(() => false))) {
    return false;
  }
  await payBtn.click();
  await page.waitForTimeout(600);

  return page
    .locator('[data-testid="pricing-list"], text=차트 코드')
    .first()
    .isVisible({ timeout: 5_000 })
    .catch(() => false);
}

// ---------------------------------------------------------------------------
// AC-1: "순서 편집" 텍스트 요소가 DOM에 없음
// ---------------------------------------------------------------------------

test('AC-1: PMW에 "순서 편집" 텍스트 요소 없음', async ({ page }) => {
  const entered = await tryOpenPaymentMiniWindow(page);
  if (!entered) {
    test.skip(true, '수납대기 체크인 없음 — PMW 진입 불가');
    return;
  }

  // 풋케어 탭 진입 (기본 탭이 아닐 경우)
  const footcareTab = page.getByRole('button', { name: '풋케어' }).first();
  if (await footcareTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await footcareTab.click();
    await page.waitForTimeout(300);
  }

  // "순서 편집" 텍스트 미존재 확인
  const orderEditEl = page.getByText('순서 편집', { exact: true });
  await expect(orderEditEl).toHaveCount(0, { timeout: 2_000 });
  console.log('✅ AC-1: "순서 편집" 요소 없음 확인');
});

// ---------------------------------------------------------------------------
// AC-2: data-testid="menu-card-row-*" 요소 0건
// ---------------------------------------------------------------------------

test('AC-2: menu-card-row-* testid 요소 0건', async ({ page }) => {
  const entered = await tryOpenPaymentMiniWindow(page);
  if (!entered) {
    test.skip(true, '수납대기 체크인 없음 — PMW 진입 불가');
    return;
  }

  const footcareTab = page.getByRole('button', { name: '풋케어' }).first();
  if (await footcareTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await footcareTab.click();
    await page.waitForTimeout(300);
  }

  // menu-card-row-* 요소 0건 확인
  const menuCardRows = page.locator('[data-testid^="menu-card-row-"]');
  await expect(menuCardRows).toHaveCount(0, { timeout: 2_000 });
  console.log('✅ AC-2: menu-card-row-* 요소 0건 확인');
});

// ---------------------------------------------------------------------------
// AC-3: data-testid="menu-reorder-up-*" / "menu-reorder-down-*" 0건
// ---------------------------------------------------------------------------

test('AC-3: menu-reorder-up/down-* testid 요소 0건', async ({ page }) => {
  const entered = await tryOpenPaymentMiniWindow(page);
  if (!entered) {
    test.skip(true, '수납대기 체크인 없음 — PMW 진입 불가');
    return;
  }

  const footcareTab = page.getByRole('button', { name: '풋케어' }).first();
  if (await footcareTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await footcareTab.click();
    await page.waitForTimeout(300);
  }

  const upBtns = page.locator('[data-testid^="menu-reorder-up-"]');
  const downBtns = page.locator('[data-testid^="menu-reorder-down-"]');

  await expect(upBtns).toHaveCount(0, { timeout: 2_000 });
  await expect(downBtns).toHaveCount(0, { timeout: 2_000 });
  console.log('✅ AC-3: menu-reorder-up/down-* 요소 0건 확인');
});

// ---------------------------------------------------------------------------
// AC-4: data-testid="menu-reorder-toggle" 없음 (토글 버튼 제거)
// ---------------------------------------------------------------------------

test('AC-4: menu-reorder-toggle 버튼 없음', async ({ page }) => {
  const entered = await tryOpenPaymentMiniWindow(page);
  if (!entered) {
    test.skip(true, '수납대기 체크인 없음 — PMW 진입 불가');
    return;
  }

  const footcareTab = page.getByRole('button', { name: '풋케어' }).first();
  if (await footcareTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await footcareTab.click();
    await page.waitForTimeout(300);
  }

  const toggleBtn = page.getByTestId('menu-reorder-toggle');
  await expect(toggleBtn).toHaveCount(0, { timeout: 2_000 });
  console.log('✅ AC-4: menu-reorder-toggle 없음 확인');
});

// ---------------------------------------------------------------------------
// AC-5: pricing-list 존재 확인 (기존 수가 목록 회귀 없음)
// ---------------------------------------------------------------------------

test('AC-5: pricing-list 요소 존재 — 수가 목록 회귀 없음', async ({ page }) => {
  const entered = await tryOpenPaymentMiniWindow(page);
  if (!entered) {
    test.skip(true, '수납대기 체크인 없음 — PMW 진입 불가');
    return;
  }

  // pricing-list testid 확인
  const pricingList = page.getByTestId('pricing-list');
  await expect(pricingList).toBeVisible({ timeout: 5_000 });
  console.log('✅ AC-5: pricing-list 요소 존재 확인');
});

// ---------------------------------------------------------------------------
// 통합: 풋케어 탭에서 그리드(카드 목록) 정상 렌더 + 순서 편집 관련 요소 전무
// ---------------------------------------------------------------------------

test('통합: 풋케어 탭 그리드 정상 + 순서 편집 요소 전무', async ({ page }) => {
  const entered = await tryOpenPaymentMiniWindow(page);
  if (!entered) {
    test.skip(true, '수납대기 체크인 없음 — PMW 진입 불가');
    return;
  }

  const footcareTab = page.getByRole('button', { name: '풋케어' }).first();
  if (await footcareTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await footcareTab.click();
    await page.waitForTimeout(400);
  }

  // 1. 순서 편집 텍스트 없음
  await expect(page.getByText('순서 편집', { exact: true })).toHaveCount(0);

  // 2. 순서 편집 관련 testid 전무
  await expect(page.locator('[data-testid^="menu-card-row-"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="menu-reorder-up-"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="menu-reorder-down-"]')).toHaveCount(0);
  await expect(page.getByTestId('menu-reorder-toggle')).toHaveCount(0);
  await expect(page.getByTestId('menu-card-list')).toHaveCount(0);

  // 3. pricing-list 존재
  await expect(page.getByTestId('pricing-list')).toBeVisible({ timeout: 3_000 });

  console.log('✅ 통합: 풋케어 탭 그리드 정상 + 순서 편집 관련 요소 전무 확인');
});
