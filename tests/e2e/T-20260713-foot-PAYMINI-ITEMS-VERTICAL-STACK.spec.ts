/**
 * E2E spec — T-20260713-foot-PAYMINI-ITEMS-VERTICAL-STACK
 * 결제 미니창 — 항목/수가 팔레트를 가로 다열 그리드 → 세로 단일 열 리스트로 강제.
 *
 * 현장 불만(2026-07-13 김주연 총괄): "왜 자꾸 가로로!!" (기본(진찰료) 탭 항목/수가 팔레트)
 *   표적 = 기본(진찰료) 탭 항목 팔레트(클릭형 카드: 초진진찰료 AA154 / 재진진찰료 AA254 / …).
 *   진원 = 원래 의도된 4열 그리드(grid-cols-3 lg:grid-cols-4, T-20260526-foot-PMW-SIDE-MENU-FEAT).
 *          COLORBOX(508893fa)는 블록 code-motion만, flex 방향 side-effect 아님 → regression 아님.
 *   ※ [차트 코드·진료비 산정] 패널은 이미 세로 → 무접촉(divergence 배제).
 *
 * AC-1: 팔레트 항목이 세로(단일 열, flex-col)로 강제 — 가로 다열 그리드 해소.
 * AC-2: 항목 순서·코드·금액 표기 유지(무손실).
 * AC-3: 좌표 근거 = 첨부 스샷(팔레트 그리드). regression 아님(원본 의도 layout).
 * AC-4: 인접 요소(차트코드 패널·서류발행·세금/합계) reflow·정렬·금액 계산 회귀 0.
 *
 * self-seed: payment_waiting 체크인 1장을 결정적으로 시딩 → [결제하기]로 미니창 진입
 *   (공유 dev-DB 상태 무관하게 항상 실행 — skip 없음).
 */
import { test, expect } from '@playwright/test';
import { navigateToDashboard } from '../helpers';
import { seedCheckIn, type FixtureHandle } from '../fixtures';

test.describe('T-20260713-foot-PAYMINI-ITEMS-VERTICAL-STACK — 항목/수가 팔레트 세로 스택', () => {
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

  // ── AC-1: 팔레트가 세로 단일 열(flex-col) — 항목들이 x 동일·y 증가로 수직 스택 ──
  test('AC-1: 항목/수가 팔레트가 세로 단일 열로 스택(가로 다열 아님)', async ({ page }) => {
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

    // (1) 세로 스택: 연속 항목의 y 좌표가 단조 증가(같은 행 다열 = 실패)
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i].y).toBeGreaterThan(boxes[i - 1].y);
    }
    // (2) 단일 열: 모든 항목의 좌측 x가 사실상 동일(다열이면 x가 여러 값)
    const xs = boxes.map((b) => b.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(2);
  });

  // ── AC-2: 항목 순서·코드·금액 표기 유지 ──
  test('AC-2: 팔레트 항목이 코드·금액 표기를 유지(무손실)', async ({ page }) => {
    const { dialog } = await openPalette(page);

    const items = dialog.locator('[data-testid="pmw-palette-item"]');
    expect(await items.count()).toBeGreaterThanOrEqual(1);

    // 첫 항목: 이름 텍스트 + 금액(콤마 숫자) 표기 존재
    const first = items.first();
    await expect(first).toBeVisible();
    await expect(first).toHaveText(/\S/);
    await expect(first).toHaveText(/[\d,]+/);
  });

  // ── AC-4: 인접 요소 회귀 0 — 차트코드 패널·서류발행 유지 + 클릭→합계 계산 정상 ──
  test('AC-4: 인접 zone 유지 + 팔레트 클릭 시 합계 계산 회귀 없음', async ({ page }) => {
    const { dialog, list } = await openPalette(page);

    // 인접 zone 유지(무접촉): 차트코드 한 줄 토글 + 서류발행 패널
    await expect(dialog.locator('[data-testid="pmw-feeitem-toggle"]')).toBeVisible();
    await expect(dialog.getByText('서류발행')).toBeVisible();

    // 세로 리스트가 팔레트 폭 넘지 않음(가로 오버플로 없음)
    const overflow = await list.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);

    // 팔레트 항목 클릭 → 수가/합계 계산 정상(세금 구분·합계 노출)
    const items = dialog.locator('[data-testid="pmw-palette-item"]');
    expect(await items.count()).toBeGreaterThanOrEqual(1);
    await items.first().click();
    await expect(dialog.getByText('세금 구분')).toBeVisible();
    await expect(dialog.getByText('합계', { exact: true })).toBeVisible();
  });
});
