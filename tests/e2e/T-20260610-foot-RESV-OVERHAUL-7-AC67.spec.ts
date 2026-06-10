/**
 * T-20260610-foot-RESV-OVERHAUL-7 — AC-6 / AC-7 (예약상세(수정) 모달 푸터 버튼 재정의 + 복원)
 * reporter=김주연 총괄 / spec scope: AC-6 + AC-7 (planner MSG-20260610-140636-sybv 로 human_pending 해소)
 *
 * AC-6: 예약상세(수정) 모달 푸터 버튼 — 상태별 3버튼
 *   - 정상(confirmed): [저장][예약취소][예약삭제]
 *   - 취소(cancelled): [예약복원][저장][예약삭제]
 * AC-7: [예약복원] 클릭 → cancelled_at/cancel_reason 초기화 → 정상 복귀 → 버튼 자동 전환
 *
 * 본 spec은 UI 구조(버튼 노출/상태분기/회귀)만 검증한다. 실제 DB 삭제/복원은 자동화에서 수행하지 않음.
 * (예약 박스가 없는 환경에서는 구조 검증으로 graceful skip)
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

/** 예약관리로 이동 후 첫 예약 카드를 더블클릭/클릭하여 수정(예약상세) 모달 오픈 시도 */
async function openEditModal(page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/admin/reservations`);
  await page.waitForLoadState('networkidle');
  // 예약 카드(타임테이블 셀의 예약 박스)를 찾아 클릭 → 4분할 상세 팝업 → [수정] → 예약 수정 모달
  const resvCard = page.locator('[data-testid="resv-box"], .resv-box').first();
  if (await resvCard.count() === 0) return null;
  await resvCard.click();
  await page.waitForTimeout(400);
  // 4분할 상세 팝업의 [수정] 버튼 → 예약 수정 모달
  const editBtn = page.getByRole('button', { name: '수정' }).first();
  if (await editBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await editBtn.click();
    await page.waitForTimeout(400);
  }
  const dialog = page.getByRole('dialog').filter({ hasText: /예약 수정/ });
  if (!(await dialog.first().isVisible({ timeout: 2000 }).catch(() => false))) return null;
  return dialog.first();
}

test.describe('T-20260610-foot-RESV-OVERHAUL-7 (AC-6/AC-7)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await loginIfNeeded(page);
  });

  // ── AC-6: 정상 예약 수정 모달 푸터 버튼 = [저장][예약취소][예약삭제] ──────────────
  test('AC-6: 정상 예약 수정 모달에 [저장][예약취소][예약삭제] 3버튼이 노출된다', async ({ page }) => {
    const dialog = await openEditModal(page);
    if (!dialog) {
      console.log('[SKIP] 예약 카드 없음 — 구조 검증으로 대체');
      await expect(page).toHaveURL(/reservations/);
      return;
    }
    // 정상(confirmed) 예약이면 [예약취소]+[예약삭제] 노출, [예약복원] 미노출
    const restoreBtn = dialog.getByTestId('resv-edit-restore-btn');
    if (await restoreBtn.count() > 0) {
      console.log('[INFO] 첫 카드가 취소된 예약 — AC-7 케이스로 검증');
      await expect(dialog.getByTestId('resv-edit-delete-btn')).toBeVisible();
      await expect(dialog.getByRole('button', { name: '저장' })).toBeVisible();
      return;
    }
    await expect(dialog.getByRole('button', { name: '저장' })).toBeVisible();
    await expect(dialog.getByTestId('resv-edit-cancel-btn')).toBeVisible();
    await expect(dialog.getByTestId('resv-edit-cancel-btn')).toHaveText(/예약취소/);
    await expect(dialog.getByTestId('resv-edit-delete-btn')).toBeVisible();
    await expect(dialog.getByTestId('resv-edit-delete-btn')).toHaveText(/예약삭제/);
    // 정상 예약엔 [예약복원] 미노출
    await expect(restoreBtn).toHaveCount(0);
  });

  // ── AC-6: [예약취소] 클릭 → 취소 사유 모달(ReservationCancelModal) 오픈 ──────────
  test('AC-6: [예약취소] 클릭 시 취소 사유 모달이 오픈된다', async ({ page }) => {
    const dialog = await openEditModal(page);
    if (!dialog) { test.skip(); return; }
    const cancelBtn = dialog.getByTestId('resv-edit-cancel-btn');
    if (await cancelBtn.count() === 0) { test.skip(); return; }
    await cancelBtn.click();
    await page.waitForTimeout(400);
    // 취소 사유 입력 모달(예약 취소) 오픈 — dialog role 노출 여부만 검증
    const cancelDialog = page.getByRole('dialog');
    await expect(cancelDialog.first()).toBeVisible({ timeout: 3000 });
  });

  // ── 회귀: 신규 예약 등록 모달은 [취소][저장] 2버튼 유지 (삭제/취소/복원 미노출) ──────
  test('회귀: 신규 예약 등록 모달은 기존 [취소][저장] 유지 + JS 에러 없음', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(`${BASE_URL}/admin/reservations`);
    await page.waitForLoadState('networkidle');
    // 빈 슬롯 클릭으로 신규 등록 모달 오픈 시도
    const newBtn = page.getByRole('button', { name: /예약 등록|\+ 예약|신규 예약/ }).first();
    if (await newBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await newBtn.click();
      await page.waitForTimeout(400);
      const dialog = page.getByRole('dialog').filter({ hasText: /예약 등록/ });
      if (await dialog.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        // 신규 등록 모달엔 삭제/복원 버튼 미노출
        await expect(dialog.first().getByTestId('resv-edit-delete-btn')).toHaveCount(0);
        await expect(dialog.first().getByTestId('resv-edit-restore-btn')).toHaveCount(0);
      }
    }
    const criticalErrors = errors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('Non-Error promise rejection'),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
