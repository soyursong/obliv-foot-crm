/**
 * T-20260522-foot-RESV-CAL-COLWIDTH
 * 예약관리 주간 캘린더 칼럼 너비 통일 + 토요일 한 화면 표시
 *
 * AC-1: 월~토 6개 칼럼 너비 동일(균등 배분) — table-fixed 적용 확인
 * AC-2: 고객 이름(최대 4글자+성함) 잘림 없음 — min-width 또는 ellipsis 방어
 * AC-3: 기본 뷰포트(1280px+) 및 태블릿 가로 모드에서 토요일까지 한 화면 표시
 * AC-4: 예약 카드 내 정보(이름·차트번호·초재진·상태) 가독성 유지
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

test.describe('T-20260522-foot-RESV-CAL-COLWIDTH — 주간 캘린더 칼럼 너비 통일', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE_URL);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/reservations`);
    await page.waitForLoadState('networkidle');
  });

  // AC-1: table-fixed 클래스 적용 확인 → 6칸 균등 배분의 CSS 근거
  test('AC-1: 주간 캘린더 table에 table-fixed 클래스 적용', async ({ page }) => {
    const table = page.locator('table').first();
    await expect(table).toBeVisible({ timeout: 8000 });
    await expect(table).toHaveClass(/table-fixed/);
  });

  // AC-1: 주간 뷰에서 요일 헤더(th) 6개 존재 확인
  test('AC-1: 주간 뷰 요일 헤더 6개(월~토) 존재', async ({ page }) => {
    await expect(page.locator('table').first()).toBeVisible({ timeout: 8000 });

    // 시간축 th를 제외한 요일 th — thead tr 내부 th 중 첫 번째(시간) 제외
    const headers = page.locator('thead tr th');
    // 시간 + 6요일 = 7개
    await expect(headers).toHaveCount(7);
  });

  // AC-1: 모든 요일 칼럼 너비가 동일한지 확인 (table-fixed + equal colgroup 없을 때 자동 균등)
  test('AC-1: 월~토 6개 칼럼 헤더 너비 균등 (±2px 허용)', async ({ page }) => {
    await expect(page.locator('table').first()).toBeVisible({ timeout: 8000 });

    // 시간축 th 제외, 요일 th만 선택 (index 1~6)
    const dayHeaders = page.locator('thead tr th').filter({ hasNotText: '시간' });
    const count = await dayHeaders.count();

    if (count < 2) {
      test.skip();
      return;
    }

    // 첫 번째 요일 칼럼 너비 기준
    const firstBox = await dayHeaders.nth(0).boundingBox();
    if (!firstBox) {
      test.skip();
      return;
    }

    const baseWidth = firstBox.width;

    // 모든 요일 칼럼 너비가 기준 ±2px 이내인지 검증
    for (let i = 1; i < count; i++) {
      const box = await dayHeaders.nth(i).boundingBox();
      if (!box) continue;
      expect(Math.abs(box.width - baseWidth)).toBeLessThanOrEqual(2);
    }
  });

  // AC-3: 1280px 뷰포트에서 가로 스크롤 없음 — 토요일 칼럼 표시 보장
  test('AC-3: 1280px 뷰포트에서 캘린더 가로 스크롤 없음', async ({ page }) => {
    await expect(page.locator('table').first()).toBeVisible({ timeout: 8000 });

    // 스크롤 컨테이너(table을 감싸는 overflow-auto div) 가로 오버플로 체크
    const container = page.locator('.flex-1.overflow-auto.rounded-lg.border').first();
    const hasHScroll = await container.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(hasHScroll).toBe(false);
  });

  // AC-3: 토요일(6번째) 헤더가 뷰포트 내 가시 영역에 포함되는지 확인
  test('AC-3: 토요일 칼럼 헤더가 뷰포트 내 표시 (화면 밖 밀림 없음)', async ({ page }) => {
    await expect(page.locator('table').first()).toBeVisible({ timeout: 8000 });

    // 요일 헤더 6번째 = 토요일 (index 5, 시간축 th 제외)
    const dayHeaders = page.locator('thead tr th').filter({ hasNotText: '시간' });
    const count = await dayHeaders.count();

    if (count < 6) {
      test.skip();
      return;
    }

    const saturdayHeader = dayHeaders.nth(5);
    await expect(saturdayHeader).toBeInViewport({ ratio: 0.5 });
  });

  // AC-3: 태블릿 가로 모드(1024px) — 토요일 표시 확인
  test('AC-3: 태블릿 가로(1024px) 뷰포트에서 토요일 칼럼 표시', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`${BASE_URL}/reservations`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('table').first()).toBeVisible({ timeout: 8000 });

    const dayHeaders = page.locator('thead tr th').filter({ hasNotText: '시간' });
    const count = await dayHeaders.count();

    if (count < 6) {
      test.skip();
      return;
    }

    const saturdayHeader = dayHeaders.nth(5);
    await expect(saturdayHeader).toBeInViewport({ ratio: 0.5 });
  });

  // AC-2: 예약 카드가 overflow-hidden + w-full 클래스 보유 (이름 잘림 방어)
  test('AC-2: 예약 카드 overflow-hidden + w-full → 이름 잘림 방어 CSS 확인', async ({ page }) => {
    await expect(page.locator('table').first()).toBeVisible({ timeout: 8000 });

    const cards = page.locator('[data-testid^="resv-card-"]');
    const count = await cards.count();

    if (count === 0) {
      test.skip();
      return;
    }

    const card = cards.first();
    await expect(card).toHaveClass(/overflow-hidden/);
    await expect(card).toHaveClass(/w-full/);
  });

  // AC-4: 예약 카드 내 방문유형·상태 텍스트 표시 확인
  test('AC-4: 예약 카드 내 방문유형(초진/재진) + 상태 텍스트 가독성', async ({ page }) => {
    await expect(page.locator('table').first()).toBeVisible({ timeout: 8000 });

    const cards = page.locator('[data-testid^="resv-card-"]');
    const count = await cards.count();

    if (count === 0) {
      test.skip();
      return;
    }

    const card = cards.first();
    // 방문유형 텍스트 (초진·재진·선체험 중 하나)와 상태(예약·체크인·취소·노쇼)가 포함
    await expect(card).toContainText(/초진|재진|선체험/);
    await expect(card).toContainText(/예약|체크인|취소|노쇼/);
  });

  // AC-4: 예약 카드 이름 행에 min-w-0 포함 (flex 수축 허용)
  test('AC-4: 예약 카드 이름 행 flex container에 min-w-0 적용', async ({ page }) => {
    await expect(page.locator('table').first()).toBeVisible({ timeout: 8000 });

    const cards = page.locator('[data-testid^="resv-card-"]');
    const count = await cards.count();

    if (count === 0) {
      test.skip();
      return;
    }

    // 카드 내부 첫 번째 flex 행 (이름·차트번호 행)
    const nameRow = cards.first().locator('.flex.min-w-0.items-center').first();
    await expect(nameRow).toBeVisible();
    await expect(nameRow).toHaveClass(/min-w-0/);
  });
});
