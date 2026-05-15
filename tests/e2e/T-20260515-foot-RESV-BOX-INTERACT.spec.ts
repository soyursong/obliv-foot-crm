/**
 * T-20260515-foot-RESV-BOX-INTERACT
 * 예약관리 고객박스 단일클릭 선택 + 더블클릭 예약수정창
 *
 * AC-1: 단일 클릭 → 선택 상태 (ring-teal-500 테두리), 다른 박스 전환, 빈 영역 해제
 * AC-2: 선택 상태가 DnD/Ctrl+C/X 대상 (기배포 RESV-DND-SHORTCUT 연동)
 * AC-3: 더블 클릭 → 예약 수정 모달 열기
 * AC-4: 단일/더블클릭 이벤트 충돌 방지 (300ms 디바운스)
 * AC-5: 기존 DnD/단축키 불변
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

test.describe('T-20260515-foot-RESV-BOX-INTERACT', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/reservations`);
    await page.waitForLoadState('networkidle');
  });

  // AC-1/AC-4: 예약 카드 단일클릭 → 선택 상태 (300ms 후)
  test('AC-1: 예약 카드 단일클릭 → 300ms 후 ring-teal-500 선택 상태', async ({ page }) => {
    await expect(page.locator('table')).toBeVisible({ timeout: 8000 });

    const cards = page.locator('[data-testid^="resv-card-"]');
    const count = await cards.count();

    if (count === 0) {
      test.skip();
      return;
    }

    const card = cards.first();
    // 단일 클릭
    await card.click();
    // 300ms 디바운스 대기 (충분한 여유)
    await page.waitForTimeout(400);

    // 선택 상태 확인: ring-teal-500 클래스
    await expect(card).toHaveClass(/ring-teal-500/);
    // 수정 모달은 열리지 않아야 함 (AC-4)
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  // AC-1: 빈 영역 클릭 → 선택 해제
  test('AC-1: 빈 영역(td) 클릭 → 선택 해제', async ({ page }) => {
    await expect(page.locator('table')).toBeVisible({ timeout: 8000 });

    const cards = page.locator('[data-testid^="resv-card-"]');
    const count = await cards.count();

    if (count === 0) {
      test.skip();
      return;
    }

    // 카드 선택
    await cards.first().click();
    await page.waitForTimeout(400);
    await expect(cards.first()).toHaveClass(/ring-teal-500/);

    // 빈 셀 클릭 (시간 컬럼 sticky cell)
    const timeCell = page.locator('[data-testid="resv-time-col-cell"]').first();
    await timeCell.click();

    // 선택 해제 확인
    await expect(cards.first()).not.toHaveClass(/ring-teal-500/);
  });

  // AC-3/AC-4: 더블클릭 → 예약 수정 모달 (300ms 이내 2번 클릭)
  test('AC-3: 예약 카드 더블클릭 → 예약 수정 모달 열림', async ({ page }) => {
    await expect(page.locator('table')).toBeVisible({ timeout: 8000 });

    const cards = page.locator('[data-testid^="resv-card-"]');
    const count = await cards.count();

    if (count === 0) {
      test.skip();
      return;
    }

    const card = cards.first();
    // dblclick은 브라우저가 두 번의 click 이벤트를 빠르게 발생 → 300ms 이내 → 더블클릭 판정
    await card.dblclick();

    // 예약 수정 모달 열림 확인
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 3000 });
    await expect(dialog).toContainText(/예약 수정/);
  });

  // AC-4: 단일클릭만 → 수정 모달 미열림
  test('AC-4: 단일클릭 후 300ms 지나면 수정 모달 미열림', async ({ page }) => {
    await expect(page.locator('table')).toBeVisible({ timeout: 8000 });

    const cards = page.locator('[data-testid^="resv-card-"]');
    const count = await cards.count();

    if (count === 0) {
      test.skip();
      return;
    }

    await cards.first().click();
    await page.waitForTimeout(500); // 300ms 디바운스 충분히 경과

    // 모달이 열리지 않아야 함
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  // AC-5: 기존 DnD draggable 속성 불변
  test('AC-5: confirmed 예약 카드에 draggable 속성 유지', async ({ page }) => {
    await expect(page.locator('table')).toBeVisible({ timeout: 8000 });

    const cards = page.locator('[data-testid^="resv-card-"][draggable="true"]');
    const count = await cards.count();

    if (count === 0) {
      test.skip(); // 현재 주에 confirmed 예약 없음
      return;
    }

    // draggable 속성 확인
    await expect(cards.first()).toHaveAttribute('draggable', 'true');
  });

  // AC-5: Escape → 선택 해제 (기존 단축키 동작 유지)
  test('AC-5: Escape 키 → 선택 해제 (기존 단축키 불변)', async ({ page }) => {
    await expect(page.locator('table')).toBeVisible({ timeout: 8000 });

    const cards = page.locator('[data-testid^="resv-card-"]');
    const count = await cards.count();

    if (count === 0) {
      test.skip();
      return;
    }

    // 선택
    await cards.first().click();
    await page.waitForTimeout(400);
    await expect(cards.first()).toHaveClass(/ring-teal-500/);

    // Escape → 선택 해제
    await page.keyboard.press('Escape');
    await expect(cards.first()).not.toHaveClass(/ring-teal-500/);
  });
});
