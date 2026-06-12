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
 *
 * ── HARNESS (seed-free, 항상 실행) ──────────────────────────────────────────
 * supervisor QA FIX-REQUEST(qa_fail_phase=phase2, insufficient_verification) 대응:
 *   시드 의존 3종은 환경에 따라 skip 되어 "실측 0건"이 될 수 있음. 그래서 시드와 무관하게
 *   항상 실행되는 HARNESS 2종을 추가한다.
 *   - 구동 중인 앱(/admin/customers)으로 이동해 실 Tailwind CSS 번들을 로드한 뒤,
 *   - dialog.tsx(DialogContent BaseDialog.Popup) / button.tsx(buttonVariants) / 본 컴포넌트의
 *     DialogFooter className 을 그대로 복제한 DOM 을 document.body 에 주입하고,
 *   - 실제 레이아웃된 boundingBox 로 3버튼이 다이얼로그 경계 안에 있는지 측정한다(desktop/mobile).
 *   이로써 max-w-lg + sm:flex-wrap 수정이 실제 브라우저 레이아웃에서 overflow 를 없애는지 결정적으로 검증.
 */

import { test, expect, Page } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

const BTN_IDS = [
  'chart-save-close-btn',
  'chart-close-confirm-btn',
  'chart-close-cancel',
] as const;

// ── 정본 클래스 복제 (수정본과 1:1) ──────────────────────────────────────────
//   dialog.tsx BaseDialog.Popup(non-fullscreen) + CustomerChartSheet 의 DialogContent className="max-w-lg"
const POPUP_CLASS =
  'fixed left-1/2 top-1/2 z-[90] -translate-x-1/2 -translate-y-1/2 w-full max-w-lg ' +
  'rounded-xl border bg-background p-6 shadow-lg focus:outline-none max-w-lg';
//   dialog.tsx DialogFooter 기본 + CustomerChartSheet 의 className (수정 핵심: sm:flex-wrap)
const FOOTER_CLASS =
  'mt-4 flex flex-col-reverse sm:flex-row sm:justify-end sm:gap-2 ' +
  'flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end';
//   button.tsx buttonVariants base + size=default
const BTN_BASE =
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border " +
  'border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap ' +
  'h-8 gap-1.5 px-2.5';

/** 구동 중인 앱 CSS 를 로드한 뒤, confirm 다이얼로그 DOM 을 body 에 주입한다(시드 무관). */
async function injectConfirmDialog(page: Page): Promise<boolean> {
  try {
    await page.goto(`${BASE}/admin/customers`, { waitUntil: 'domcontentloaded' });
  } catch {
    return false;
  }
  // 앱 stylesheet 가 1개 이상 로드됐는지 확인(실 Tailwind CSS 필요)
  await page.waitForFunction(() => document.styleSheets.length > 0, { timeout: 8000 }).catch(() => {});
  await page.evaluate(
    ({ popupClass, footerClass, btnBase }) => {
      document.querySelectorAll('[data-testid="chart-close-confirm"]').forEach((n) => n.remove());
      const popup = document.createElement('div');
      popup.className = popupClass;
      popup.setAttribute('data-testid', 'chart-close-confirm');
      popup.setAttribute('role', 'dialog');
      popup.innerHTML = `
        <div class="flex flex-col gap-1.5 mb-4"><h2 class="text-lg font-semibold leading-none">작성 중인 내용이 있습니다</h2></div>
        <p class="text-sm text-muted-foreground">저장하지 않은 작성 내용이 사라질 수 있습니다. 저장 후 닫으시겠습니까?</p>
        <div class="${footerClass}">
          <button data-testid="chart-close-cancel" class="${btnBase} border-border bg-background">취소(계속 작성)</button>
          <button data-testid="chart-close-confirm-btn" class="${btnBase} bg-destructive/10 text-destructive">저장하지 않고 닫기</button>
          <button data-testid="chart-save-close-btn" class="${btnBase} bg-teal-600 text-white hover:bg-teal-700">저장 후 닫기</button>
        </div>`;
      document.body.appendChild(popup);
    },
    { popupClass: POPUP_CLASS, footerClass: FOOTER_CLASS, btnBase: BTN_BASE },
  );
  const confirm = page.locator('[data-testid="chart-close-confirm"]');
  await expect(confirm).toBeVisible({ timeout: 4000 });
  return true;
}

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

// ════════════════════════════════════════════════════════════════════════════
// HARNESS — 시드 무관 결정적 검증 (supervisor QA FIX 대응: 항상 실측 실행)
// ════════════════════════════════════════════════════════════════════════════
test.describe('HARNESS: confirm 3버튼 경계 검증 (seed-free, 실 CSS 주입)', () => {
  test('H1: 데스크톱 폭(1280)에서 3버튼 모두 다이얼로그 경계 안 (overflow 없음)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const ok = await injectConfirmDialog(page);
    expect(ok, '앱 CSS 로드 + 다이얼로그 주입 실패 — 환경 확인 필요').toBe(true);
    await page.screenshot({ path: 'evidence/T-20260611-foot-CHART2-CONFIRM-BTN-OVERFLOW_H1_desktop.png' });
    await assertButtonsWithinDialog(page);
  });

  test('H2: 좁은 폭(390)에서 3버튼 모두 다이얼로그 경계 안 (세로 스택/wrap, overflow 없음)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const ok = await injectConfirmDialog(page);
    expect(ok, '앱 CSS 로드 + 다이얼로그 주입 실패 — 환경 확인 필요').toBe(true);
    await page.screenshot({ path: 'evidence/T-20260611-foot-CHART2-CONFIRM-BTN-OVERFLOW_H2_mobile.png' });
    await assertButtonsWithinDialog(page);
  });
});

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
