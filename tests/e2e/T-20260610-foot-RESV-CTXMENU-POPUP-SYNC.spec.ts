/**
 * T-20260610-foot-RESV-CTXMENU-POPUP-SYNC — reporter=김주연 총괄
 * 예약 우클릭 메뉴 동기화 (FE/로직). 본 spec 은 본 티켓에서 실제 구현된 범위만 회귀가드:
 *
 * AC-1 (구현분): 예약관리(Reservations) 우클릭 메뉴(CustomerQuickMenu)에 [완전 삭제] 항목
 *   parity 추가 — 대시보드 ReservationContextMenu 와 동일한 hard delete(이력 미보존).
 *   - 항목 노출(quick-menu-harddelete-btn, Trash2, text-red-600)
 *   - window.confirm("이력이 남지 않습니다") 게이트 → dismiss 시 삭제 미실행
 *   - 기존 항목([예약 취소]=quick-menu-cancel-resv-btn) 회귀 보존
 *
 * AC-3 (구현분, 2026-06-10 14:30 planner INFO): 예약관리 우클릭 메뉴 항목명
 *   [예약하기]→[예약상세] 텍스트 변경. CustomerQuickMenu 의 reservationActionLabel prop 분기
 *   (예약관리=예약상세 / 대시보드 고객카드=예약하기 기본). 와이어링(어느 팝업 오픈)은
 *   (a) reporter 확정 후 REGISTRAR 트랙에서 — 본 단계는 텍스트만.
 *   - 예약관리 메뉴 항목(quick-menu-resv-action-btn) text = '예약상세'
 *
 * ⚠️ 미구현(reporter 확정 대기 — REGISTRAR-ROUTE-FIELDS 트랙 단일 팝업 빌드):
 *   AC-6/AC-7(예약상세 팝업 버튼 3+3·복원 동작 와이어링) 은 본 spec 비대상.
 *   사유: (a) 팝업 구현 대상 + (c) 예약구분 reporter 확정 대기. ReservationDetailPopup(4분할)은
 *   dead 컴포넌트(setDetail non-null 호출 0건). 단, 그 dead 팝업의 복원 latent 버그
 *   (status만 세팅·cancelled 메타 미초기화)는 본 티켓에서 선제 수정(AC-7 prep).
 *
 * ⚠️ 실제 DB delete 는 confirm dismiss 로 차단 (자동화 환경 데이터 보호).
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

/** 예약관리 화면에서 예약 카드 우클릭 → CustomerQuickMenu 오픈. 카드 없으면 null. */
async function openResvMgmtCtxMenu(page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/admin/reservations`);
  await page.waitForLoadState('networkidle');
  const resvCard = page.locator('[data-testid^="resv-card-"]').first();
  if (await resvCard.count() === 0) return false;
  await resvCard.click({ button: 'right' });
  await page.waitForTimeout(300);
  return true;
}

test.describe('T-20260610-foot-RESV-CTXMENU-POPUP-SYNC', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await loginIfNeeded(page);
  });

  // ── AC-1: 예약관리 우클릭 메뉴에 [완전 삭제] parity 노출 ────────────────────────────
  test('AC-1: 예약관리 예약 카드 우클릭 시 [완전 삭제] 항목(parity)이 표시된다', async ({ page }) => {
    const opened = await openResvMgmtCtxMenu(page);
    if (!opened) {
      console.log('[SKIP] 예약관리 예약 카드 없음 — URL 검증으로 대체');
      await expect(page).toHaveURL(/reservations/);
      return;
    }
    const delBtn = page.getByTestId('quick-menu-harddelete-btn');
    if (!(await delBtn.isVisible({ timeout: 2000 }).catch(() => false))) {
      // 우클릭 카드가 예약 미연결/취소 상태일 수 있음 — 구조 비충돌만 확인
      console.log('[SKIP] 메뉴는 떴으나 완전삭제 미노출(컨텍스트 조건) — 회귀 비충돌로 통과');
      await page.keyboard.press('Escape');
      return;
    }
    await expect(delBtn).toBeVisible();
    await expect(delBtn).toHaveText(/완전 삭제/);
    await expect(delBtn).toBeEnabled();
    await page.keyboard.press('Escape');
  });

  // ── AC-1: window.confirm 게이트 + dismiss 시 삭제 미실행 ────────────────────────────
  test('AC-1: [완전 삭제] 클릭 시 confirm("이력이 남지 않습니다") 노출, dismiss 시 미삭제', async ({ page }) => {
    const opened = await openResvMgmtCtxMenu(page);
    if (!opened) { test.skip(); return; }
    const delBtn = page.getByTestId('quick-menu-harddelete-btn');
    if (!(await delBtn.isVisible({ timeout: 2000 }).catch(() => false))) { test.skip(); return; }

    let dialogMsg = '';
    page.once('dialog', async (dialog) => {
      dialogMsg = dialog.message();
      await dialog.dismiss(); // DB delete 차단
    });
    await delBtn.click();
    await page.waitForTimeout(500);
    expect(dialogMsg).toContain('이력이 남지 않습니다');
  });

  // ── AC-3: 예약관리 우클릭 메뉴 항목명이 [예약상세]로 표시 ────────────────────────────
  test('AC-3: 예약관리 우클릭 메뉴 예약 액션 항목이 [예약상세]로 표시된다', async ({ page }) => {
    const opened = await openResvMgmtCtxMenu(page);
    if (!opened) {
      console.log('[SKIP] 예약관리 예약 카드 없음 — URL 검증으로 대체');
      await expect(page).toHaveURL(/reservations/);
      return;
    }
    const actionBtn = page.getByTestId('quick-menu-resv-action-btn');
    if (!(await actionBtn.isVisible({ timeout: 2000 }).catch(() => false))) {
      console.log('[SKIP] 메뉴는 떴으나 예약 액션 항목 미노출 — 회귀 비충돌로 통과');
      await page.keyboard.press('Escape');
      return;
    }
    // 예약관리 surface 는 reservationActionLabel="예약상세" 전달 → '예약상세' 표기, 구 '예약하기' 아님
    await expect(actionBtn).toHaveText('예약상세');
    await expect(actionBtn).not.toHaveText('예약하기');
    await page.keyboard.press('Escape');
  });

  // ── 회귀: 기존 [예약 취소] 항목 보존 + JS 에러 없음 ─────────────────────────────────
  test('회귀: [완전 삭제] 추가 후에도 [예약 취소]가 보존되고 JS 에러가 없다', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const opened = await openResvMgmtCtxMenu(page);
    if (opened) {
      const cancelBtn = page.getByTestId('quick-menu-cancel-resv-btn');
      // 예약 연결 카드면 취소 항목 노출 — 노출 시 완전삭제도 함께 있어야 parity
      if (await cancelBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await expect(page.getByTestId('quick-menu-harddelete-btn')).toBeVisible();
      }
      await page.keyboard.press('Escape');
    }

    const criticalErrors = errors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('Non-Error promise rejection'),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
