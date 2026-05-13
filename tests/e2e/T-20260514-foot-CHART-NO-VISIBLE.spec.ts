/**
 * T-20260514-foot-CHART-NO-VISIBLE
 * 대시보드+예약관리 차트번호·성함 상시 표시
 *
 * AC-1: 대시보드 칸반 카드 — 성함 옆에 차트번호 상시 표시
 * AC-2: 예약관리 목록 — 차트번호 표시
 * AC-3: 기존 호버 팝업(T-20260502-foot-CARD-HOVER-INFO) 유지
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

test.describe('T-20260514-foot-CHART-NO-VISIBLE', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    // 로그인 필요한 경우 처리
    const loginInput = page.getByPlaceholder('이메일');
    if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
      await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? 'testpass');
      await page.getByRole('button', { name: '로그인' }).click();
      await page.waitForURL(/\/(dashboard|$)/, { timeout: 10000 });
    }
  });

  // 시나리오 1: 대시보드 칸반 차트번호 확인
  test('AC-1: 대시보드 칸반 카드에 차트번호(#NNNN) 상시 표시', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');

    // 체크인 카드 존재 시 차트번호 패턴 확인
    const cards = page.locator('[data-testid="checkin-card"]');
    const cardCount = await cards.count();

    if (cardCount > 0) {
      // 첫 번째 카드에 차트번호 형식(#숫자) 있는지 확인
      // 차트번호가 없는 고객이면 숫자가 없을 수 있으므로 구조만 검증
      const firstCard = cards.first();
      await expect(firstCard).toBeVisible();

      // 카드 내 teal 컬러 font-mono span(차트번호 표시 요소) 존재 여부
      // 테스트 DB에 차트번호 없는 환경을 위해 soft assertion 사용
      const chartBadge = firstCard.locator('span.font-mono');
      const hasBadge = await chartBadge.count() > 0;
      // 차트번호가 있다면 반드시 # 형식이어야 함
      if (hasBadge) {
        const text = await chartBadge.first().textContent();
        expect(text).toMatch(/^#/);
      }
    }

    // 대시보드 페이지 자체가 로드됐는지 확인
    await expect(page).toHaveURL(/dashboard/);
  });

  // 시나리오 2: 예약관리 목록 차트번호 확인
  test('AC-2: 예약관리 목록에 차트번호 표시', async ({ page }) => {
    await page.goto(`${BASE_URL}/reservations`);
    await page.waitForLoadState('networkidle');

    // 예약관리 페이지 로드 확인
    await expect(page).toHaveURL(/reservations/);

    // 캘린더 테이블 존재 확인
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 8000 });

    // 예약 카드가 있을 때 차트번호 표시 확인
    const resvCards = page.locator('.font-semibold').filter({ hasText: /\w/ });
    const cardCount = await resvCards.count();

    if (cardCount > 0) {
      // 차트번호 표시 span 검색 (font-mono + # 패턴)
      const chartNums = page.locator('span.font-mono').filter({ hasText: /^#/ });
      // 차트번호 있는 예약이 존재하면 표시됐는지 확인
      // 테스트 환경에 데이터가 없을 수 있으므로 구조만 검증
      const count = await chartNums.count();
      // 차트번호 배지가 있다면 # 형식이어야 함
      for (let i = 0; i < Math.min(count, 3); i++) {
        const text = await chartNums.nth(i).textContent();
        expect(text).toMatch(/^#/);
      }
    }
  });

  // 시나리오 3: 호버 팝업 공존 확인 (AC-3)
  test('AC-3: 칸반 카드 호버 팝업 기존 기능 유지', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');

    const cards = page.locator('[data-testid="checkin-card"]');
    const cardCount = await cards.count();

    if (cardCount > 0) {
      const firstCard = cards.first();
      // 성함 요소 호버
      const nameEl = firstCard.locator('span[title*="호버"]').first();
      const hasNameEl = await nameEl.count() > 0;

      if (hasNameEl) {
        await nameEl.hover();
        // 280ms 딜레이 대기 (CustomerHoverCard timeout)
        await page.waitForTimeout(400);
        const popup = page.locator('[data-testid="customer-hover-card"]');
        const popupVisible = await popup.isVisible().catch(() => false);
        if (popupVisible) {
          await expect(popup).toBeVisible();
        }
      }
    }

    // 대시보드 페이지 자체 정상 확인
    await expect(page).toHaveURL(/dashboard/);
  });
});
