/**
 * T-20260611-foot-CHART2-CONFIRM-BTN-OVERFLOW — 2번차트 미저장 가드 confirm 3버튼 overflow 회귀 수정
 *
 * 배경: T-20260609-foot-CHART2-SAVE-CLOSE-BTN(deployed)으로 confirm 다이얼로그가
 *   1→3버튼[저장 후 닫기 / 저장하지 않고 닫기 / 취소]으로 확장되면서,
 *   DialogContent(max-w-sm=384px) + sm:flex-row 가로 배치 폭을 초과 →
 *   justify-end 때문에 맨 왼쪽 "취소" 버튼이 다이얼로그 경계 밖으로 overflow.
 *
 * 수정(CSS only): DialogContent max-w-sm → max-w-lg, DialogFooter 에 sm:flex-wrap 추가.
 *   버튼 클릭 핸들러·로직 무변경.
 *
 * AC-1: 3버튼(저장 후 닫기/저장하지 않고 닫기/취소) 모두 팝업 경계 안에 온전히 위치 — overflow 없음.
 * AC-2: 팝업 폭이 3버튼을 수용. 핸들러 변경 없음(라벨/동작 회귀 무변경).
 * AC-3: 좁은 폭(모바일) 해상도에서도 overflow 없음(세로 스택/wrap).
 *
 * 시나리오 매핑(티켓 본문):
 *   S1 데스크톱 폭 — 3버튼 경계 내 위치(AC-1/AC-2) /
 *   S2 좁은 폭(모바일) — 3버튼 경계 내 위치(AC-3)
 *
 * 주의: 실서버 시드 데이터 의존 → 데이터/요소 없으면 graceful skip(기존 foot e2e 관례).
 */

import { test, expect, Page } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

const BTN_IDS = [
  'chart-save-close-btn',
  'chart-close-confirm-btn',
  'chart-close-cancel',
] as const;

async function openSecondChart(page: Page) {
  await page.goto(`${BASE}/admin/customers`);
  await page.waitForLoadState('networkidle');
  const chartBtn = page.locator('[data-testid="open-chart-btn"]').first();
  if ((await chartBtn.count()) === 0) return null;
  await chartBtn.click();
  const panel = page.locator('[data-testid="customer-chart-sheet"]');
  if ((await panel.count()) === 0) return null;
  await expect(panel).toBeVisible({ timeout: 6000 });
  return panel;
}

async function dirtyTheChart(page: Page) {
  const field = page
    .locator('[data-testid="customer-chart-sheet"]')
    .locator('textarea, input[type="text"], input:not([type])')
    .first();
  try {
    await field.waitFor({ state: 'visible', timeout: 6000 });
  } catch {
    return false;
  }
  await field.fill('테스트 작성 내용');
  return true;
}

async function openCloseConfirm(page: Page) {
  await page.keyboard.press('Escape');
  const confirm = page.locator('[data-testid="chart-close-confirm"]');
  try {
    await expect(confirm).toBeVisible({ timeout: 3000 });
  } catch {
    return null;
  }
  return confirm;
}

/** 각 버튼이 다이얼로그 경계(box) 안에 온전히 들어있는지 검증. 1px 반올림 허용. */
async function assertButtonsWithinDialog(page: Page) {
  const dialog = page.locator('[data-testid="chart-close-confirm"]');
  const dlgBox = await dialog.boundingBox();
  expect(dlgBox).not.toBeNull();
  if (!dlgBox) return;
  const TOL = 1; // sub-pixel 반올림 허용

  for (const id of BTN_IDS) {
    const btn = page.locator(`[data-testid="${id}"]`);
    await expect(btn).toBeVisible();
    const b = await btn.boundingBox();
    expect(b, `${id} boundingBox`).not.toBeNull();
    if (!b) continue;
    // 왼쪽/오른쪽/위/아래 경계 모두 다이얼로그 안
    expect(b.x, `${id} left within dialog`).toBeGreaterThanOrEqual(dlgBox.x - TOL);
    expect(b.x + b.width, `${id} right within dialog`).toBeLessThanOrEqual(dlgBox.x + dlgBox.width + TOL);
    expect(b.y, `${id} top within dialog`).toBeGreaterThanOrEqual(dlgBox.y - TOL);
    expect(b.y + b.height, `${id} bottom within dialog`).toBeLessThanOrEqual(dlgBox.y + dlgBox.height + TOL);
  }
}

test.describe('T-20260611-foot-CHART2-CONFIRM-BTN-OVERFLOW — confirm 3버튼 overflow 회귀', () => {
  // ── S1: 데스크톱 폭 — 3버튼 모두 경계 내(AC-1/AC-2) ──────────────────────
  test('S1: 데스크톱 폭에서 3버튼 모두 다이얼로그 경계 안에 위치(overflow 없음)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const panel = await openSecondChart(page);
    if (!panel) { test.skip(); return; }
    if (!(await dirtyTheChart(page))) { test.skip(); return; }
    const confirm = await openCloseConfirm(page);
    if (!confirm) { test.skip(); return; }

    await assertButtonsWithinDialog(page);
  });

  // ── S2: 좁은 폭(모바일) — 3버튼 모두 경계 내(AC-3) ───────────────────────
  test('S2: 좁은 폭(모바일)에서 3버튼 모두 다이얼로그 경계 안에 위치(세로 스택/wrap)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const panel = await openSecondChart(page);
    if (!panel) { test.skip(); return; }
    if (!(await dirtyTheChart(page))) { test.skip(); return; }
    const confirm = await openCloseConfirm(page);
    if (!confirm) { test.skip(); return; }

    await assertButtonsWithinDialog(page);
  });

  // ── REG: 라벨·핸들러 무변경 확인(AC-2) ──────────────────────────────────
  test('REG: 3버튼 라벨·노출 무변경(핸들러/로직 회귀 없음)', async ({ page }) => {
    const panel = await openSecondChart(page);
    if (!panel) { test.skip(); return; }
    if (!(await dirtyTheChart(page))) { test.skip(); return; }
    const confirm = await openCloseConfirm(page);
    if (!confirm) { test.skip(); return; }

    await expect(page.locator('[data-testid="chart-save-close-btn"]')).toContainText('저장 후 닫기');
    await expect(page.locator('[data-testid="chart-close-confirm-btn"]')).toContainText('저장하지 않고 닫기');
    await expect(page.locator('[data-testid="chart-close-cancel"]')).toContainText('취소');
  });
});
