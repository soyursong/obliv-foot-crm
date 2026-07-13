/**
 * E2E spec — T-20260713-foot-PAYMINI-VERTICAL-STACK-REVERT
 * 결제 미니창 — 항목/수가 팔레트 세로화(VERTICAL-STACK, commit 4b5025a) 원복.
 *
 * 현장 지시(2026-07-13 김주연 총괄, ch C0ATE5P6JTH): "그냥 원래대로 원복시켜".
 *   16:41 배포된 세로 단일 열(flex-col) field-soak 반려 → 원본 가로 다열 그리드로 복원.
 *   deliverable = 커밋 4b5025a 결정론적 undo(팔레트 flex-col → 원본 grid-cols-3 lg:grid-cols-4).
 *
 * AC-1: 팔레트가 원본 가로 다열 그리드(grid-cols-3 lg:grid-cols-4)로 복원 — flex-col 세로 스택 아님.
 * AC-2: 항목 순서·코드·금액 표기 유지(무손실).
 * AC-3/AC-4: 인접 요소(차트코드 패널·서류발행·세금/합계) reflow·정렬·금액 계산 회귀 0.
 *
 * self-seed: payment_waiting 체크인 1장을 결정적으로 시딩 → [결제하기]로 미니창 진입
 *   (공유 dev-DB 상태 무관하게 항상 실행 — skip 없음). data-testid pmw-palette-list/item 유지.
 */
import { test, expect } from '@playwright/test';
import { navigateToDashboard } from '../helpers';
import { seedCheckIn, type FixtureHandle } from '../fixtures';

test.describe('T-20260713-foot-PAYMINI-VERTICAL-STACK-REVERT — 팔레트 가로 다열 그리드 복원', () => {
  let seed: (FixtureHandle & { customerId: string; phone: string }) | null = null;

  test.beforeEach(async () => {
    seed = await seedCheckIn({ status: 'payment_waiting', visit_type: 'new' });
  });

  test.afterEach(async () => {
    if (seed) await seed.cleanup();
    seed = null;
  });

  async function openPalette(page: import('@playwright/test').Page) {
    await page.setViewportSize({ width: 1280, height: 900 });
    const ok = await navigateToDashboard(page);
    expect(ok).toBeTruthy();

    const settleBtn = page.locator('button').filter({ hasText: /결제하기/ }).first();
    await settleBtn.waitFor({ state: 'visible', timeout: 15_000 });
    await settleBtn.click();

    const dialog = page.locator('[role="dialog"]').filter({ hasText: /결제 미니창/ });
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });

    const footcareTab = dialog.getByRole('button', { name: '풋케어', exact: true });
    if ((await footcareTab.count()) > 0) await footcareTab.click();

    const list = dialog.locator('[data-testid="pmw-palette-list"]');
    await list.waitFor({ state: 'visible', timeout: 8_000 });
    return { dialog, list };
  }

  // ── AC-1: 팔레트가 가로 다열 그리드로 복원 — 첫 행에 2개 이상 항목이 같은 y로 나란히 ──
  test('AC-1: 항목/수가 팔레트가 가로 다열 그리드로 렌더(세로 단일 열 아님)', async ({ page }) => {
    const { dialog } = await openPalette(page);

    const items = dialog.locator('[data-testid="pmw-palette-item"]');
    const n = await items.count();
    expect(n).toBeGreaterThanOrEqual(2);

    const boxes: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const b = await items.nth(i).boundingBox();
      if (b) boxes.push({ x: Math.round(b.x), y: Math.round(b.y) });
    }
    expect(boxes.length).toBeGreaterThanOrEqual(2);

    // (1) 다열: 최소 한 쌍의 항목이 같은 행(y 근접)에서 서로 다른 x에 위치
    //     → 순수 세로 flex-col(모든 항목 x 동일)이면 실패.
    const distinctX = new Set(boxes.map((b) => b.x));
    expect(distinctX.size).toBeGreaterThanOrEqual(2);

    // (2) 첫 두 항목이 동일 행(y 사실상 동일)에 나란히 = 가로 배치 확증
    const rowMates = boxes.filter((b) => Math.abs(b.y - boxes[0].y) <= 4);
    expect(rowMates.length).toBeGreaterThanOrEqual(2);
  });

  // ── AC-2: 항목 순서·코드·금액 표기 유지 ──
  test('AC-2: 팔레트 항목이 코드·금액 표기를 유지(무손실)', async ({ page }) => {
    const { dialog } = await openPalette(page);

    const items = dialog.locator('[data-testid="pmw-palette-item"]');
    expect(await items.count()).toBeGreaterThanOrEqual(1);

    const first = items.first();
    await expect(first).toBeVisible();
    await expect(first).toHaveText(/\S/);
    await expect(first).toHaveText(/[\d,]+/);
  });

  // ── AC-3/AC-4: 인접 요소 회귀 0 — 차트코드 패널·서류발행 유지 + 클릭→합계 계산 정상 ──
  test('AC-4: 인접 zone 유지 + 팔레트 클릭 시 합계 계산 회귀 없음', async ({ page }) => {
    const { dialog } = await openPalette(page);

    // 인접 zone 유지(무접촉): 차트코드 한 줄 토글 + 서류발행 패널
    await expect(dialog.locator('[data-testid="pmw-feeitem-toggle"]')).toBeVisible();
    await expect(dialog.getByText('서류발행')).toBeVisible();

    // 팔레트 항목 클릭 → 수가/합계 계산 정상(세금 구분·합계 노출)
    const items = dialog.locator('[data-testid="pmw-palette-item"]');
    expect(await items.count()).toBeGreaterThanOrEqual(1);
    await items.first().click();
    await expect(dialog.getByText('세금 구분')).toBeVisible();
    await expect(dialog.getByText('합계', { exact: true })).toBeVisible();
  });
});
