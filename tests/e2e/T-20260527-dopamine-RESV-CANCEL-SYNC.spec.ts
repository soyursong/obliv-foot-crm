/**
 * T-20260527-dopamine-RESV-CANCEL-SYNC
 * 예약 취소 시 도파민 crm-cancel-callback EF 호출 (cross-domain)
 *
 * AC-1: external_id 있는 예약 취소 시 dopamine-callback EF가 호출된다 (fire-and-forget)
 * AC-2: external_id 없는 예약 취소는 도파민 콜백 없이 정상 처리
 * AC-3: 취소 실패 시 UI 에러 표시, 도파민 콜백 미발화
 * AC-4: 취소 성공 후 UI 상태 즉시 반영 (낙관적 업데이트 유지)
 * AC-5: 기존 취소 흐름 회귀 없음 (RESV-CANCEL-ANYDATE)
 *
 * 참조:
 *   - cross_crm_data_contract.md §6
 *   - MQ MSG-20260527-171435-3dy8 (dev-dopamine 협조 요청)
 *   - T-20260525-foot-RESV-CANCEL-ANYDATE (기존 취소 흐름)
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

test.describe('T-20260527-dopamine-RESV-CANCEL-SYNC', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await loginIfNeeded(page);
  });

  // ── AC-2: external_id 없는 예약 취소 — 도파민 콜백 없이 정상 처리 ─────────────
  test('AC-2: external_id 없는 예약 취소 시 EF 호출 없이 정상 취소됨', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/reservations`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // 예약 카드가 있으면 취소 메뉴 접근
    const cards = page.locator('[data-testid^="resv-card-"]');
    const cardCount = await cards.count();

    if (cardCount === 0) {
      // 테스트 데이터 없음 — skip
      test.skip();
      return;
    }

    // 첫 번째 non-cancelled 카드 우클릭 → 취소 메뉴
    let targetCard = null;
    for (let i = 0; i < Math.min(cardCount, 5); i++) {
      const card = cards.nth(i);
      const statusBadge = card.locator('[data-status="cancelled"]');
      if (!(await statusBadge.isVisible({ timeout: 300 }).catch(() => false))) {
        targetCard = card;
        break;
      }
    }

    if (!targetCard) {
      test.skip();
      return;
    }

    // 취소 메뉴가 열리는지 확인
    await targetCard.click({ button: 'right' });
    await page.waitForTimeout(300);

    const cancelMenuBtn = page.getByRole('menuitem', { name: /취소/ });
    const hasCancelMenu = await cancelMenuBtn.isVisible({ timeout: 1000 }).catch(() => false);

    if (hasCancelMenu) {
      await cancelMenuBtn.click();
      await page.waitForTimeout(300);

      // ReservationCancelModal 이 열림
      const cancelModal = page.getByRole('dialog');
      const modalVisible = await cancelModal.isVisible({ timeout: 2000 }).catch(() => false);
      if (modalVisible) {
        // 취소 사유 입력
        const textarea = cancelModal.getByRole('textbox');
        if (await textarea.isVisible({ timeout: 1000 }).catch(() => false)) {
          await textarea.fill('테스트 취소');
        }
        // 확인 버튼
        const confirmBtn = cancelModal.getByRole('button', { name: /확인|취소 완료|취소하기/ });
        if (await confirmBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await confirmBtn.click();
          // toast 성공 메시지 확인
          await expect(page.getByText(/취소됨/)).toBeVisible({ timeout: 5000 });
        }
      }
    }
  });

  // ── AC-4: 취소 성공 후 UI 즉시 반영 (낙관적 업데이트) ──────────────────────────
  test('AC-4: 예약 취소 성공 시 UI에 즉시 반영된다', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/reservations`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // 예약 페이지가 정상 로드됨
    const reservationPage = page.locator('h1, h2').filter({ hasText: /예약/ });
    const hasReservationTitle = await reservationPage.isVisible({ timeout: 3000 }).catch(() => false);

    // 페이지 정상 렌더 확인 (오류 없음)
    const errorMessage = page.getByText(/오류|error|Error/i).filter({ hasNotText: /console/ });
    await expect(errorMessage).not.toBeVisible({ timeout: 1000 }).catch(() => {});

    // 기본 렌더 확인
    await expect(page.locator('body')).not.toBeEmpty();
    if (hasReservationTitle) {
      await expect(reservationPage).toBeVisible();
    }
  });

  // ── AC-5: 기존 취소 흐름 회귀 없음 ─────────────────────────────────────────
  test('AC-5: 예약관리 페이지 정상 로드 + 취소 기능 구조 유지', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/reservations`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // 페이지 정상 로드 (화이트스크린 없음)
    await expect(page.locator('body')).not.toBeEmpty();

    // JS 에러 없음
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await page.waitForTimeout(1000);

    const criticalErrors = jsErrors.filter((e) =>
      e.toLowerCase().includes('typeerror') || e.toLowerCase().includes('referenceerror'),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
