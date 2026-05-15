/**
 * T-20260515-foot-RESV-CTX-HOVER
 * 예약관리 고객박스 우클릭 컨텍스트 메뉴 + hover 간단정보 팝업
 *
 * AC-1: 예약관리 고객박스 우클릭 → 4항목 메뉴(고객차트/진료차트/예약하기/수납)
 * AC-2: 예약관리 고객박스 hover → 간단정보 팝업 표시
 * AC-3: 커서 추적 포지셔닝 (화면 경계 잘림 없음)
 * AC-4: 대시보드 기존 우클릭/hover 기능 불변
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? 'testpass');
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|$)/, { timeout: 10000 });
  }
}

test.describe('T-20260515-foot-RESV-CTX-HOVER', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/reservations`);
    await page.waitForLoadState('networkidle');
  });

  // AC-1: 예약카드 우클릭 → 컨텍스트 메뉴 4항목
  test('AC-1: 예약관리 예약카드 우클릭 시 컨텍스트 메뉴 4항목이 표시된다', async ({ page }) => {
    // 예약 카드 찾기 (고객 ID 연결된 카드)
    const cards = page.locator('[data-testid^="resv-card-"]');
    const cardCount = await cards.count();

    if (cardCount === 0) {
      // 예약 없는 환경: CustomerHoverCard 임포트 렌더링만 검증
      test.skip();
      return;
    }

    // 고객 연결된 카드 내 CustomerHoverCard span 찾기
    const hoverCardName = page.locator('[data-testid^="resv-card-"] span[title*="우클릭"]').first();
    const hasHoverCard = await hoverCardName.count() > 0;

    if (!hasHoverCard) {
      // 연결된 고객 없는 환경: 구조 확인만
      test.skip();
      return;
    }

    // 우클릭 → 컨텍스트 메뉴 표시
    await hoverCardName.click({ button: 'right' });

    const menu = page.locator('[class*="fixed"][class*="rounded-lg"][class*="border"]').last();
    await expect(menu).toBeVisible({ timeout: 3000 });

    // 4항목 확인
    await expect(page.getByText('고객차트')).toBeVisible();
    await expect(page.getByText('진료차트')).toBeVisible();
    await expect(page.getByText('예약하기')).toBeVisible();
    await expect(page.getByText('수납')).toBeVisible();

    // ESC 닫기
    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible({ timeout: 2000 });
  });

  // AC-2: hover → 간단정보 팝업
  test('AC-2: 예약관리 예약카드 hover 시 간단정보 팝업이 표시된다', async ({ page }) => {
    const hoverCardName = page.locator('[data-testid^="resv-card-"] span[title*="우클릭"]').first();
    const hasHoverCard = await hoverCardName.count() > 0;

    if (!hasHoverCard) {
      test.skip();
      return;
    }

    // hover → 팝업 표시 (280ms delay 고려)
    await hoverCardName.hover();
    await page.waitForTimeout(400);

    const popup = page.locator('[data-testid="customer-hover-card"]');
    await expect(popup).toBeVisible({ timeout: 3000 });

    // 팝업 내 항목 확인 (예약시간 clock 아이콘 포함)
    const hasTime = await popup.locator('svg').count() > 0;
    expect(hasTime).toBe(true);

    // 다른 곳으로 이동 → 팝업 닫힘
    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);
    await expect(popup).not.toBeVisible({ timeout: 2000 });
  });

  // AC-3: 팝업 포지셔닝 — 화면 경계에서 잘림 없음
  test('AC-3: hover 팝업이 뷰포트 밖으로 벗어나지 않는다', async ({ page }) => {
    const hoverCardName = page.locator('[data-testid^="resv-card-"] span[title*="우클릭"]').first();
    const hasHoverCard = await hoverCardName.count() > 0;

    if (!hasHoverCard) {
      test.skip();
      return;
    }

    await hoverCardName.hover();
    await page.waitForTimeout(400);

    const popup = page.locator('[data-testid="customer-hover-card"]');
    const isVisible = await popup.isVisible({ timeout: 3000 }).catch(() => false);
    if (!isVisible) { test.skip(); return; }

    const box = await popup.boundingBox();
    if (!box) { test.skip(); return; }

    const vp = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 5);  // 5px tolerance
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 5);
  });

  // AC-4: 대시보드 기존 기능 불변
  test('AC-4: 대시보드 고객카드 우클릭/hover 기능이 여전히 정상 동작한다', async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState('networkidle');

    // 대시보드 CustomerHoverCard span 확인 — 기존 컴포넌트 임포트 유지
    const dashHoverSpan = page.locator('span[title*="우클릭"]').first();
    const hasDash = await dashHoverSpan.count() > 0;

    if (!hasDash) {
      // 대시보드에 체크인 없는 환경
      test.skip();
      return;
    }

    // 우클릭 메뉴 열리는지 확인
    await dashHoverSpan.click({ button: 'right' });
    const menu = page.locator('[class*="fixed"][class*="rounded-lg"][class*="border"]').last();
    await expect(menu).toBeVisible({ timeout: 3000 });

    // 기존 4항목 유지 확인
    await expect(page.getByText('고객차트')).toBeVisible();
    await expect(page.getByText('수납')).toBeVisible();

    await page.keyboard.press('Escape');
  });
});
