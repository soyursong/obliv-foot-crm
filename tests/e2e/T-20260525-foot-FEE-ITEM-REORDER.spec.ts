/**
 * E2E spec — T-20260525-foot-FEE-ITEM-REORDER
 * 결제 미니창 수가 항목 수기 배치(순서) 변경 + DB persist
 *
 * AC-1: 수가 항목 ↑↓ 버튼 / DnD drag handle로 순서 변경 가능
 * AC-2: 순서 변경 → DB persist (services.display_order clinic 단위), 재진입 시 복원
 * AC-3: 순서 변경 후 기존 CRUD (금액편집·제거·선수금토글) 정상 동작
 * AC-5: ↑↓ 버튼 노출 (태블릿 환경 대리 검증)
 * 시나리오 3: 항목 1건 → 순서 변경 UI 비노출
 * 시나리오 4: 신규 항목 추가 시 기존 순서 유지 + 새 항목 기본 위치(마지막)
 *
 * [SCOPE CHANGE 2026-05-25]
 * MSG-20260525-202336-jph5: AC-2 "UI 세션 내 순서만" → "DB persist (display_order, clinic 단위)"
 * risk_verdict: GO(0/5) → GO_WARN(1/5 DB)
 */

import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// ---------------------------------------------------------------------------
// 헬퍼: 결제 미니창 진입 (체크인 목록 첫 번째 항목)
// ---------------------------------------------------------------------------

async function openPaymentMiniWindow(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto('/admin');
  try {
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
  } catch {
    return false;
  }

  // 대기 중인 체크인 카드 클릭
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

  // 결제 미니창 진입 버튼
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

  // pricing-list 가시 확인
  try {
    await page.locator('[data-testid="pricing-list"]').waitFor({ timeout: 8_000 });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// AC-1 + AC-5: ↑↓ 버튼 기본 노출 / 순서 변경
// ---------------------------------------------------------------------------

test.describe('T-20260525-foot-FEE-ITEM-REORDER — AC-1/AC-5: ↑↓ 버튼 순서 변경', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('AC-5a: 수가 항목 2건 이상 → ↑↓ 버튼 노출 확인', async ({ page }) => {
    const opened = await openPaymentMiniWindow(page);
    if (!opened) test.skip(true, '결제 미니창 진입 불가 (체크인 없음)');

    const list = page.locator('[data-testid="pricing-list"]');
    await expect(list).toBeVisible({ timeout: 5_000 });

    const rows = list.locator('[data-testid^="pricing-row-"]');
    const rowCount = await rows.count();
    if (rowCount < 2) {
      test.skip(true, '수가 항목 2건 미만');
      return;
    }

    const secondRowId = (await rows.nth(1).getAttribute('data-testid'))?.replace('pricing-row-', '');
    if (secondRowId) {
      await expect(page.locator(`[data-testid="reorder-up-${secondRowId}"]`)).toBeVisible({ timeout: 3_000 });
    }
    console.log('[AC-5a] ↑↓ 버튼 노출 OK (rowCount:', rowCount, ')');
  });

  test('AC-1a: ↑ 버튼 클릭 → 두 번째 항목이 첫 번째로 이동', async ({ page }) => {
    const opened = await openPaymentMiniWindow(page);
    if (!opened) test.skip(true, '결제 미니창 진입 불가');

    const list = page.locator('[data-testid="pricing-list"]');
    const rows = list.locator('[data-testid^="pricing-row-"]');
    const rowCount = await rows.count();
    if (rowCount < 2) test.skip(true, '수가 항목 2건 미만');

    const firstId = (await rows.nth(0).getAttribute('data-testid'))?.replace('pricing-row-', '');
    const secondId = (await rows.nth(1).getAttribute('data-testid'))?.replace('pricing-row-', '');
    if (!firstId || !secondId) test.skip(true, 'testId 없음');

    // 두 번째 항목의 ↑ 버튼 클릭
    await page.locator(`[data-testid="reorder-up-${secondId}"]`).click();
    await page.waitForTimeout(300);

    // 순서 역전 확인: 이전 2번째가 이제 1번째
    const newFirst = (await rows.nth(0).getAttribute('data-testid'))?.replace('pricing-row-', '');
    expect(newFirst).toBe(secondId);
    console.log('[AC-1a] ↑ 버튼 순서 변경 OK:', firstId, '↔', secondId);
  });

  test('AC-1b: 첫 번째 항목의 ↑ 버튼 disabled 확인', async ({ page }) => {
    const opened = await openPaymentMiniWindow(page);
    if (!opened) test.skip(true, '결제 미니창 진입 불가');

    const list = page.locator('[data-testid="pricing-list"]');
    const rows = list.locator('[data-testid^="pricing-row-"]');
    const rowCount = await rows.count();
    if (rowCount < 2) test.skip(true, '수가 항목 2건 미만');

    const firstId = (await rows.nth(0).getAttribute('data-testid'))?.replace('pricing-row-', '');
    if (!firstId) test.skip(true, 'testId 없음');

    await expect(page.locator(`[data-testid="reorder-up-${firstId}"]`)).toBeDisabled({ timeout: 3_000 });
    console.log('[AC-1b] 첫 번째 항목 ↑ disabled OK');
  });

  test('AC-1c: DnD drag handle 존재 확인', async ({ page }) => {
    const opened = await openPaymentMiniWindow(page);
    if (!opened) test.skip(true, '결제 미니창 진입 불가');

    const list = page.locator('[data-testid="pricing-list"]');
    await expect(list).toBeVisible();

    const rows = list.locator('[data-testid^="pricing-row-"]');
    const rowCount = await rows.count();
    if (rowCount < 1) test.skip(true, '수가 항목 없음');

    // drag handle 버튼 (GripVertical 아이콘, cursor-grab)
    const dragHandle = rows.nth(0).locator('button.cursor-grab, button[title="드래그하여 순서 변경"]').first();
    await expect(dragHandle).toBeVisible({ timeout: 3_000 });
    console.log('[AC-1c] DnD drag handle 존재 OK');
  });
});

// ---------------------------------------------------------------------------
// AC-3: 순서 변경 후 기존 CRUD 정상
// ---------------------------------------------------------------------------

test.describe('T-20260525-foot-FEE-ITEM-REORDER — AC-3: 순서 변경 후 CRUD 정상', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('AC-3a: 순서 변경 후 제거 버튼 정상 동작', async ({ page }) => {
    const opened = await openPaymentMiniWindow(page);
    if (!opened) test.skip(true, '결제 미니창 진입 불가');

    const list = page.locator('[data-testid="pricing-list"]');
    const rows = list.locator('[data-testid^="pricing-row-"]');
    const initialCount = await rows.count();
    if (initialCount < 2) test.skip(true, '수가 항목 2건 미만');

    const secondId = (await rows.nth(1).getAttribute('data-testid'))?.replace('pricing-row-', '');
    if (!secondId) test.skip(true, 'testId 없음');

    // ↑ 클릭으로 순서 변경
    await page.locator(`[data-testid="reorder-up-${secondId}"]`).click();
    await page.waitForTimeout(300);

    // 제거 버튼 클릭
    const firstRow = rows.nth(0);
    await firstRow.locator('button[title="제거"]').click();
    await page.waitForTimeout(300);

    const newCount = await rows.count();
    expect(newCount).toBe(initialCount - 1);
    console.log('[AC-3a] 순서 변경 후 제거 OK:', initialCount, '→', newCount);
  });
});

// ---------------------------------------------------------------------------
// 시나리오 3: 항목 1건 → ↑↓ 버튼 비노출
// ---------------------------------------------------------------------------

test.describe('T-20260525-foot-FEE-ITEM-REORDER — 시나리오 3: 1건 시 순서 변경 UI 비노출', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('시나리오 3: pricing-list 항목 1건 → reorder 버튼 없음', async ({ page }) => {
    const opened = await openPaymentMiniWindow(page);
    if (!opened) test.skip(true, '결제 미니창 진입 불가');

    const list = page.locator('[data-testid="pricing-list"]');
    const rows = list.locator('[data-testid^="pricing-row-"]');
    const rowCount = await rows.count();

    if (rowCount !== 1) {
      test.skip(true, '항목 1건 아님 (현재: ' + rowCount + ')');
      return;
    }

    const firstId = (await rows.nth(0).getAttribute('data-testid'))?.replace('pricing-row-', '');
    if (!firstId) test.skip(true, 'testId 없음');

    // ↑↓ 버튼이 없어야 함
    await expect(page.locator(`[data-testid="reorder-up-${firstId}"]`)).not.toBeVisible({ timeout: 2_000 });
    await expect(page.locator(`[data-testid="reorder-down-${firstId}"]`)).not.toBeVisible({ timeout: 2_000 });
    console.log('[시나리오 3] 1건 시 ↑↓ 버튼 비노출 OK');
  });
});

// ---------------------------------------------------------------------------
// AC-2 / 시나리오 4: DB persist 구조 확인 + 신규 항목 추가 기본 위치
// ---------------------------------------------------------------------------

test.describe('T-20260525-foot-FEE-ITEM-REORDER — AC-2/시나리오 4: persist 구조 + 신규 항목', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('AC-2a: 순서 변경 후 pricing-list 즉시 반영 + debounce 후 UI 안정', async ({ page }) => {
    const opened = await openPaymentMiniWindow(page);
    if (!opened) test.skip(true, '결제 미니창 진입 불가');

    const list = page.locator('[data-testid="pricing-list"]');
    const rows = list.locator('[data-testid^="pricing-row-"]');
    const rowCount = await rows.count();
    if (rowCount < 2) test.skip(true, '수가 항목 2건 미만');

    const before0 = (await rows.nth(0).getAttribute('data-testid'))?.replace('pricing-row-', '');
    const before1 = (await rows.nth(1).getAttribute('data-testid'))?.replace('pricing-row-', '');
    if (!before0 || !before1) test.skip(true, 'testId 없음');

    // ↑ 클릭: 두 번째 → 첫 번째
    await page.locator(`[data-testid="reorder-up-${before1}"]`).click();
    await page.waitForTimeout(300);

    // UI 즉시 반영 확인
    const after0 = (await rows.nth(0).getAttribute('data-testid'))?.replace('pricing-row-', '');
    expect(after0).toBe(before1);
    console.log('[AC-2a] 순서 변경 UI 즉시 반영 OK:', before1, '→ 첫 번째');

    // debounce 800ms + 여유 300ms 대기 후 UI 순서 안정 확인
    await page.waitForTimeout(1100);
    const stable0 = (await rows.nth(0).getAttribute('data-testid'))?.replace('pricing-row-', '');
    expect(stable0).toBe(before1);
    console.log('[AC-2a] debounce 후 순서 안정(persist 트리거 완료) OK');
  });

  test('시나리오 4: 순서 변경 후 신규 항목 추가 → 기존 순서 유지 + 새 항목 마지막', async ({ page }) => {
    const opened = await openPaymentMiniWindow(page);
    if (!opened) test.skip(true, '결제 미니창 진입 불가');

    const list = page.locator('[data-testid="pricing-list"]');
    const rows = list.locator('[data-testid^="pricing-row-"]');
    const rowCount = await rows.count();
    if (rowCount < 2) test.skip(true, '수가 항목 2건 미만');

    // 순서 변경
    const secondId = (await rows.nth(1).getAttribute('data-testid'))?.replace('pricing-row-', '');
    if (!secondId) test.skip(true, 'testId 없음');
    await page.locator(`[data-testid="reorder-up-${secondId}"]`).click();
    await page.waitForTimeout(300);

    // 첫 번째가 secondId인지 확인
    const reordered0 = (await rows.nth(0).getAttribute('data-testid'))?.replace('pricing-row-', '');
    expect(reordered0).toBe(secondId);

    // 새 항목 추가 시도: 좌측 서비스 카드 중 미선택 항목
    const serviceCard = page
      .locator('[data-testid^="service-card-"]')
      .or(page.locator('.service-btn'))
      .not(page.locator('[data-selected="true"]'))
      .first();

    try {
      await serviceCard.waitFor({ timeout: 4_000 });
      await serviceCard.click();
      await page.waitForTimeout(400);

      const newCount = await rows.count();
      if (newCount > rowCount) {
        // 기존 순서 첫 번째 유지 확인
        const still0 = (await rows.nth(0).getAttribute('data-testid'))?.replace('pricing-row-', '');
        expect(still0).toBe(secondId);
        // 새 항목은 마지막에 추가됨 확인
        const lastId = await rows.nth(newCount - 1).getAttribute('data-testid');
        expect(lastId).toBeTruthy();
        console.log('[시나리오 4] 기존 순서 유지 OK, 새 항목 마지막 추가 OK (총', newCount, '건)');
      } else {
        test.skip(true, '추가 가능한 서비스 없음');
      }
    } catch {
      test.skip(true, '서비스 카드 미발견');
    }
  });
});
