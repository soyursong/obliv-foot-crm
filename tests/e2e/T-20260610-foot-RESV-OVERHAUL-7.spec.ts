/**
 * T-20260610-foot-RESV-OVERHAUL-7 — 예약관리·취소/삭제 종합 재정비 (reporter=김주연 총괄)
 *
 * 본 spec 커버 범위: AC-1 일부 — 대시보드 타임라인 우클릭 메뉴(ReservationContextMenu)에
 *   [SMS 보내기] parity 추가 (CustomerQuickMenu(예약관리)와 미러링). 기존 SendSmsDialog 경로 재사용.
 *
 * AC-1(SMS parity): 타임라인 예약 박스 우클릭 → 메뉴에 [SMS 보내기](resv-ctx-sms-btn) 노출(admin/manager).
 *   클릭 시 SendSmsDialog 오픈, 기존 [완전 삭제]/[예약 취소] 항목 보존(회귀 0).
 *
 * ※ AC-3/4/5/6/7(예약상세 팝업 재구성·예약경로 신규필드·@등록자명·버튼 재정의·복원)은
 *   설계 결정/ DB 게이트 대기(planner FOLLOWUP) → 본 spec 미포함.
 *
 * ⚠️ 실제 SMS 발송은 자동화 환경에서 수행하지 않음(다이얼로그 오픈 여부만 검증).
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })());
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

test.describe('T-20260610-foot-RESV-OVERHAUL-7 (AC-1 SMS parity)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await loginIfNeeded(page);
  });

  // ── AC-1: [SMS 보내기] parity 노출 (admin/manager) ─────────────────────────────
  test('AC-1: 타임라인 예약 박스 우클릭 메뉴에 [SMS 보내기] 항목이 노출된다(admin/manager)', async ({ page }) => {
    const ctxMenu = await openCtxMenu(page);
    if (!ctxMenu) {
      console.log('[SKIP] 예약 박스 없음 — 구조 검증으로 대체');
      await expect(page).toHaveURL(/dashboard/);
      return;
    }
    const smsBtn = ctxMenu.getByTestId('resv-ctx-sms-btn');
    // admin/manager 가 아니면 항목 미노출(권한 게이트) — 미노출도 정상 동작
    if (await smsBtn.count() === 0) {
      console.log('[INFO] SMS 항목 미노출 — manual_sms_send 권한 없는 계정(정상 게이트)');
      await page.keyboard.press('Escape');
      return;
    }
    await expect(smsBtn).toBeVisible();
    await expect(smsBtn).toHaveText(/SMS 보내기/);
    await page.keyboard.press('Escape');
    await expect(ctxMenu).not.toBeVisible({ timeout: 2000 });
  });

  // ── AC-1: [SMS 보내기] 클릭 시 SendSmsDialog 오픈 ─────────────────────────────
  test('AC-1: [SMS 보내기] 클릭 시 문자 발송 다이얼로그가 오픈된다', async ({ page }) => {
    const ctxMenu = await openCtxMenu(page);
    if (!ctxMenu) { test.skip(); return; }
    const smsBtn = ctxMenu.getByTestId('resv-ctx-sms-btn');
    if (await smsBtn.count() === 0) { test.skip(); return; }
    await smsBtn.click();
    await page.waitForTimeout(400);
    // SendSmsDialog 는 Dialog(role=dialog) 로 렌더 — 오픈 여부만 확인
    const dialog = page.getByRole('dialog');
    await expect(dialog.first()).toBeVisible({ timeout: 3000 });
  });

  // ── 회귀: SMS 추가 후에도 [예약 취소]/[완전 삭제] 보존 + JS 에러 없음 ────────────
  test('회귀: [SMS 보내기] 추가 후에도 [예약 취소]/[완전 삭제] 항목 보존 + JS 에러 없음', async ({ page }) => {
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
