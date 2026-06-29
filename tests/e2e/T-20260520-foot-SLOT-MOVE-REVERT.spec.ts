/**
 * T-20260520-foot-SLOT-MOVE-REVERT
 * 슬롯 이동 충돌 확인창 제거 — 즉시 이동 처리 (회귀 검증)
 *
 * AC-3a 회귀: slot-drag-conflict-dialog 가 DOM에 존재하지 않음
 * AC-3a 회귀: 드래그 후 "예약 시간 변경" 다이얼로그가 열리지 않음
 *
 * 배경: T-20260515-foot-DASH-SLOT-DRAG 에서 도입된 pendingSlotDrag + conflict Dialog가
 *       이번 REVERT 티켓에서 완전 제거됨. 해당 Dialog 요소가 더 이상 DOM에 없어야 함.
 *
 * 기존 DASH-SLOT-DRAG spec과 겹치지 않도록 describe 이름 T-20260520-foot-SLOT-MOVE-REVERT 사용.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })());
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|$)/, { timeout: 10000 });
  }
}

test.describe('T-20260520-foot-SLOT-MOVE-REVERT', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    await loginIfNeeded(page);
    // 통합 시간표가 완전히 렌더될 때까지 대기
    await page.getByTestId('timeline-time-col').waitFor({ timeout: 10000 });
  });

  // AC-3a 회귀: slot-drag-conflict-dialog testId 요소가 DOM에 0개여야 함
  test('AC-3a: slot-drag-conflict-dialog testId가 DOM에 존재하지 않는다', async ({ page }) => {
    const conflictEl = page.getByTestId('slot-drag-conflict-dialog');
    await expect(conflictEl).toHaveCount(0);
  });

  // AC-3a 회귀: 드래그 후 "예약 시간 변경" 타이틀의 dialog가 열리지 않아야 함
  test('AC-3a: 드래그 후 "예약 시간 변경" 다이얼로그가 열리지 않는다', async ({ page }) => {
    // 초진 카드(DraggableBox1Card)가 있는 경우 실제 DnD 시뮬레이션 수행
    const box1Cards = page.getByTestId('box1-resv-card');
    const cardCount = await box1Cards.count();

    if (cardCount > 0) {
      const sourceCard = box1Cards.first();
      const sourceBBox = await sourceCard.boundingBox();

      if (sourceBBox) {
        const allSlots = page.getByTestId('timeline-slot-new');
        const slotCount = await allSlots.count();

        if (slotCount >= 2) {
          // 소스 카드보다 아래 슬롯으로 드래그 시뮬레이션
          const targetSlotIdx = Math.min(slotCount - 1, 2);
          const targetSlot = allSlots.nth(targetSlotIdx);
          const targetBBox = await targetSlot.boundingBox();

          if (targetBBox) {
            await page.mouse.move(
              sourceBBox.x + sourceBBox.width / 2,
              sourceBBox.y + sourceBBox.height / 2
            );
            await page.mouse.down();
            await page.waitForTimeout(200);
            await page.mouse.move(
              targetBBox.x + targetBBox.width / 2,
              targetBBox.y + targetBBox.height / 2,
              { steps: 10 }
            );
            await page.waitForTimeout(200);
            await page.mouse.up();
            await page.waitForTimeout(500);
          }
        }
      }
    }

    // 드래그 여부와 무관하게 "예약 시간 변경" 충돌 다이얼로그는 열리지 않아야 함
    // (pendingSlotDrag state 제거로 충돌 Dialog가 완전히 삭제됨)
    const conflictDialog = page.locator('[role="dialog"]').filter({ hasText: '예약 시간 변경' });
    await expect(conflictDialog).toHaveCount(0);
  });

  // 정적 구조 검증: 대시보드에 slot-drag-conflict-dialog 관련 요소가 전혀 없음
  test('AC-3a: 정적 구조 — slot-drag-conflict-dialog 관련 DOM 요소 완전 부재', async ({ page }) => {
    // data-testid="slot-drag-conflict-dialog" 가 없어야 함
    await expect(page.getByTestId('slot-drag-conflict-dialog')).toHaveCount(0);

    // "예약 시간 변경" 텍스트가 열린 다이얼로그에 없어야 함
    const openDialogs = page.locator('[role="dialog"][data-state="open"]');
    const openCount = await openDialogs.count();
    if (openCount > 0) {
      for (let i = 0; i < openCount; i++) {
        const dialogText = await openDialogs.nth(i).textContent();
        expect(dialogText ?? '').not.toContain('예약 시간 변경');
      }
    }

    // 대시보드 정상 렌더 유지 확인
    await expect(page.getByTestId('timeline-time-col')).toBeVisible({ timeout: 5000 });
  });
});
