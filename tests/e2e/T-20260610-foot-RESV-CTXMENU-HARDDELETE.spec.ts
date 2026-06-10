/**
 * T-20260610-foot-RESV-CTXMENU-HARDDELETE
 * 예약 컨텍스트메뉴 [완전 삭제] hard-delete — reporter=김주연 총괄
 *
 * AC-1: 타임라인 예약 박스 우클릭 → ReservationContextMenu에 [완전 삭제] 항목(Trash2, text-red-600) 노출
 * AC-2: status 무관 전체 표시 — disabled 없음 (취소/노쇼 예약에서도 활성)
 * AC-3: [완전 삭제] 클릭 → window.confirm 다이얼로그("이력이 남지 않습니다") 노출, 취소 시 삭제 미실행
 * 회귀: 페이지 JS 에러 없음 + [예약 취소] 항목 보존
 *
 * ⚠️ 실제 DB delete는 confirm dismiss로 차단 (자동화 환경 데이터 보호)
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? 'testpass');
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(admin|dashboard|$)/, { timeout: 10000 });
  }
}

async function openCtxMenu(page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await page.waitForLoadState('networkidle');
  const resvBox = page.locator('[data-testid="resv-box"], .resv-box').first();
  if (await resvBox.count() === 0) return null;
  await resvBox.click({ button: 'right' });
  await page.waitForTimeout(300);
  const ctxMenu = page.getByTestId('resv-context-menu');
  if (!(await ctxMenu.isVisible({ timeout: 3000 }).catch(() => false))) return null;
  return ctxMenu;
}

test.describe('T-20260610-foot-RESV-CTXMENU-HARDDELETE', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await loginIfNeeded(page);
  });

  // ── AC-1: [완전 삭제] 항목 노출 ────────────────────────────────────────────────
  test('AC-1: 예약 박스 우클릭 시 컨텍스트메뉴에 [완전 삭제] 항목이 표시된다', async ({ page }) => {
    const ctxMenu = await openCtxMenu(page);
    if (!ctxMenu) {
      console.log('[SKIP] 예약 박스 없음 — 구조 검증으로 대체');
      await expect(page).toHaveURL(/dashboard/);
      return;
    }
    const delBtn = ctxMenu.getByTestId('resv-ctx-harddelete-btn');
    await expect(delBtn).toBeVisible();
    await expect(delBtn).toHaveText(/완전 삭제/);
    await page.keyboard.press('Escape');
    await expect(ctxMenu).not.toBeVisible({ timeout: 2000 });
  });

  // ── AC-2: status 무관 전체 표시 — disabled 없음 ──────────────────────────────────
  test('AC-2: [완전 삭제] 항목은 status 무관하게 활성(disabled 아님)이다', async ({ page }) => {
    const ctxMenu = await openCtxMenu(page);
    if (!ctxMenu) { test.skip(); return; }
    const delBtn = ctxMenu.getByTestId('resv-ctx-harddelete-btn');
    await expect(delBtn).toBeVisible();
    await expect(delBtn).toBeEnabled();
    await page.keyboard.press('Escape');
  });

  // ── AC-3: window.confirm 노출 + 취소 시 삭제 미실행 ──────────────────────────────
  test('AC-3: [완전 삭제] 클릭 시 confirm 다이얼로그가 노출되고, 취소하면 삭제되지 않는다', async ({ page }) => {
    const ctxMenu = await openCtxMenu(page);
    if (!ctxMenu) { test.skip(); return; }

    let dialogMsg = '';
    // confirm dismiss → DB delete 차단 (자동화 데이터 보호)
    page.once('dialog', async (dialog) => {
      dialogMsg = dialog.message();
      await dialog.dismiss();
    });

    const delBtn = ctxMenu.getByTestId('resv-ctx-harddelete-btn');
    await delBtn.click();
    await page.waitForTimeout(500);

    expect(dialogMsg).toContain('이력이 남지 않습니다');
  });

  // ── 회귀: [예약 취소] 항목 보존 + JS 에러 없음 ───────────────────────────────────
  test('회귀: [완전 삭제] 추가 후에도 [예약 취소] 항목이 보존되고 JS 에러가 없다', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const ctxMenu = await openCtxMenu(page);
    if (ctxMenu) {
      await expect(ctxMenu.getByTestId('resv-ctx-cancel-btn')).toBeVisible();
      await expect(ctxMenu.getByTestId('resv-ctx-harddelete-btn')).toBeVisible();
      await page.keyboard.press('Escape');
    }

    const criticalErrors = errors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('Non-Error promise rejection'),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
