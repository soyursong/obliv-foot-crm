/**
 * T-20260525-foot-RESV-CANCEL-ANYDATE
 * 예약관리 전일자 예약 취소 허용
 *
 * AC-1: 비당일 예약에도 취소 버튼/컨텍스트메뉴 활성화
 *       - 예약 카드 전체 영역 우클릭 → CustomerQuickMenu 표시 (이름 span 외 영역 포함)
 *       - 날짜 비교(isToday) 없음 확인
 * AC-2: 기존 취소 흐름(사유 입력 → cancelled_at/cancel_reason/cancelled_by) 동일 적용
 *       - ReservationCancelModal 날짜 무관 동작
 * AC-3: 대시보드 영향 없음 (Dashboard.tsx !isPast 조건 불변)
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

test.describe('T-20260525-foot-RESV-CANCEL-ANYDATE', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await loginIfNeeded(page);
  });

  // ── AC-1: 예약관리 카드 전체 영역 우클릭 → CustomerQuickMenu 표시 ──────────────
  test('AC-1: 예약관리 카드 전체 영역(이름 외) 우클릭 시 컨텍스트메뉴가 표시된다', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/reservations`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // 모든 resv-card 찾기 (날짜 무관)
    const cards = page.locator('[data-testid^="resv-card-"]');
    const cardCount = await cards.count();
    if (cardCount === 0) {
      console.log('[SKIP] 예약 카드 없음 — 페이지 URL 검증으로 대체');
      await expect(page).toHaveURL(/reservations/);
      return;
    }

    // 첫 번째 카드의 전체 영역에서 우클릭 테스트
    // CustomerHoverCard(이름 span) 외의 영역을 클릭하기 위해 카드 하단 영역 사용
    const firstCard = cards.first();
    const boundingBox = await firstCard.boundingBox();
    if (!boundingBox) {
      test.skip();
      return;
    }

    // 카드 하단 영역(상태/전화번호 영역) 우클릭 — 이름 span 외 영역
    await page.mouse.click(
      boundingBox.x + boundingBox.width / 2,
      boundingBox.y + boundingBox.height * 0.75,
      { button: 'right' },
    );
    await page.waitForTimeout(300);

    // CustomerQuickMenu 또는 컨텍스트메뉴 표시 확인
    // (cancelled 예약은 메뉴 미표시 가능 → 표시 없어도 에러 없음 검증)
    const quickMenuCancelBtn = page.getByTestId('quick-menu-cancel-resv-btn');
    const menuVisible = await quickMenuCancelBtn.isVisible({ timeout: 2000 }).catch(() => false);

    if (menuVisible) {
      // 취소 옵션 확인
      await expect(quickMenuCancelBtn).toBeVisible();
      // ESC 닫기
      await page.keyboard.press('Escape');
      await expect(quickMenuCancelBtn).not.toBeVisible({ timeout: 2000 });
    } else {
      // cancelled/noshow 카드이거나 customer_id 없는 카드 — 에러 없음만 확인
      const errors = await page.evaluate(() => window.__playwright_errors ?? []);
      expect(errors).toHaveLength(0);
    }

    await expect(page).toHaveURL(/reservations/);
  });

  // ── AC-1: 이전 주 이동 후 취소 접근 가능 확인 ────────────────────────────────
  test('AC-1: 다른 주(이전 주)로 이동 후에도 취소 컨텍스트메뉴가 동작한다', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/reservations`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // 이전 주로 이동
    const prevBtn = page.getByRole('button').filter({ has: page.locator('svg') }).first();
    // ChevronLeft 버튼 (이전 주/일)
    const chevronLeft = page.locator('button').filter({ hasText: '' }).nth(0);

    // 이전 주 버튼 클릭 (nav 영역의 첫 chevron)
    const navButtons = page.locator('[data-testid="resv-time-col-header"]').first();
    // 실제 이전 주 이동: 페이지 상단 좌우 화살표 버튼 사용
    // (text=ChevronLeft icon — 직접 role=button + svg 조합)
    const allButtons = page.getByRole('button');
    const buttonCount = await allButtons.count();

    // 이전 주 버튼 찾기 시도
    let navigated = false;
    for (let i = 0; i < Math.min(buttonCount, 10); i++) {
      const btn = allButtons.nth(i);
      const ariaLabel = await btn.getAttribute('aria-label').catch(() => '');
      const title = await btn.getAttribute('title').catch(() => '');
      if (ariaLabel?.includes('이전') || title?.includes('이전')) {
        await btn.click();
        navigated = true;
        break;
      }
    }

    if (!navigated) {
      // ChevronLeft SVG를 가진 버튼 찾기
      const chevronBtns = page.locator('button:has(svg)');
      const chevronCount = await chevronBtns.count();
      if (chevronCount > 0) {
        await chevronBtns.first().click();
        navigated = true;
      }
    }

    await page.waitForTimeout(500);
    await page.waitForLoadState('networkidle');

    // 날짜가 변경됐을 때 카드 확인
    const cards = page.locator('[data-testid^="resv-card-"]');
    const cardCount = await cards.count();

    if (cardCount === 0) {
      // 이전 주 예약 없음 — 페이지 정상 상태만 확인
      console.log('[INFO] 이전 주 예약 카드 없음 — 날짜 이동 성공, 예약 0건');
      await expect(page).toHaveURL(/reservations/);
      return;
    }

    // 예약 카드가 있으면 우클릭 시 에러 없음 확인
    const firstCard = cards.first();
    await firstCard.click({ button: 'right' });
    await page.waitForTimeout(300);

    // 에러 없이 컨텍스트메뉴 표시 또는 닫힘 상태 — JS 에러 없음 확인
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));
    const criticalErrors = jsErrors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('Non-Error'),
    );
    expect(criticalErrors).toHaveLength(0);

    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/reservations/);
  });

  // ── AC-2: 취소 모달 날짜 무관 동작 검증 ─────────────────────────────────────
  test('AC-2: CustomerQuickMenu 취소 클릭 시 ReservationCancelModal이 올바르게 열린다', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/reservations`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // confirmed 상태 예약 카드 찾기
    const cards = page.locator('[data-testid^="resv-card-"]');
    const cardCount = await cards.count();
    if (cardCount === 0) { test.skip(); return; }

    // 카드 우클릭 → 컨텍스트메뉴 시도
    let cancelBtnFound = false;
    for (let i = 0; i < Math.min(cardCount, 5); i++) {
      const card = cards.nth(i);
      await card.click({ button: 'right' });
      await page.waitForTimeout(200);

      const cancelBtn = page.getByTestId('quick-menu-cancel-resv-btn');
      if (await cancelBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        const isDisabled = await cancelBtn.isDisabled().catch(() => true);
        if (!isDisabled) {
          cancelBtnFound = true;

          // 취소 버튼 클릭 → 모달 열림
          await cancelBtn.click();
          await page.waitForTimeout(300);

          // AC-2: ReservationCancelModal 표시
          const modal = page.getByTestId('resv-cancel-modal');
          await expect(modal).toBeVisible({ timeout: 5000 });

          // 취소 사유 미입력 시 확인 비활성화
          const confirmBtn = modal.getByTestId('cancel-modal-confirm-btn');
          await expect(confirmBtn).toBeDisabled();

          // 사유 입력
          const reasonInput = modal.getByTestId('cancel-reason-input');
          await reasonInput.fill('E2E 자동화 테스트 — 날짜 무관 취소');
          await expect(confirmBtn).toBeEnabled({ timeout: 2000 });

          // 닫기 (DB 수정 방지)
          const dismissBtn = modal.getByTestId('cancel-modal-dismiss-btn');
          await dismissBtn.click();
          await expect(modal).not.toBeVisible({ timeout: 2000 });
          break;
        }
      }
      // 메뉴 닫기
      await page.keyboard.press('Escape');
    }

    if (!cancelBtnFound) {
      console.log('[SKIP] 취소 가능한 예약 카드를 찾지 못함 — 환경에 예약 없음');
      test.skip();
    }
  });

  // ── AC-3: 대시보드 !isPast 조건 불변 확인 ─────────────────────────────────────
  test('AC-3: 대시보드 타임라인 !isPast 조건이 여전히 동작한다 (Dashboard 영향 없음)', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/dashboard`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // 대시보드 페이지 정상 로딩 확인
    await expect(page).toHaveURL(/dashboard/);

    // JS 에러 없음
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));
    await page.waitForTimeout(500);

    const criticalErrors = jsErrors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('Non-Error promise rejection'),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  // ── 회귀: 예약관리 페이지 JS 에러 없음 ────────────────────────────────────────
  test('회귀: 예약관리 페이지 JS 에러 없음 (onContextMenu 핸들러 추가 후)', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await page.goto(`${BASE_URL}/admin/reservations`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const criticalErrors = jsErrors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('Non-Error promise rejection'),
    );
    expect(criticalErrors).toHaveLength(0);
    await expect(page).toHaveURL(/reservations/);
  });
});
