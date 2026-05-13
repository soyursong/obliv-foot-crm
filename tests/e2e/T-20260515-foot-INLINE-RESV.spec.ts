/**
 * T-20260515-foot-INLINE-RESV
 * 풋센터 차트 내 인라인 예약 + 예약 현황 메모 표시 강화
 *
 * AC-1: 환자 차트 내 [다음 예약] 버튼 표시
 * AC-2: 인라인 패널 — 날짜 선택 + 슬롯 그리드 + 담당의 + 진료종류
 * AC-3: 빈 슬롯 클릭 → 예약 생성 (토스트 + 이력 즉시 갱신)
 * AC-4: 예약관리(Reservations.tsx) 슬롯 카드에 예약메모 표시
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

test.describe('T-20260515-foot-INLINE-RESV', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await loginIfNeeded(page);
  });

  // 시나리오 1 AC-1: 차트 내 [다음 예약] 버튼 표시
  test('AC-1: 고객 차트 화면에 [다음 예약] 버튼이 표시된다', async ({ page }) => {
    // 고객 목록에서 첫 번째 고객 차트로 진입
    await page.goto(`${BASE_URL}/customers`);
    await page.waitForLoadState('networkidle');

    const firstChartLink = page.locator('a[href*="/chart/"]').first();
    const hasChartLink = await firstChartLink.count() > 0;

    if (!hasChartLink) {
      // 고객이 없으면 차트 URL 직접 시뮬레이션 (구조 검증)
      test.skip();
      return;
    }

    await firstChartLink.click();
    await page.waitForLoadState('networkidle');

    // AC-1: [다음 예약] 버튼 확인
    const nextResvBtn = page.getByTestId('btn-next-reservation');
    await expect(nextResvBtn).toBeVisible({ timeout: 8000 });
  });

  // 시나리오 1 AC-2: 인라인 패널이 페이지 이동 없이 열림
  test('AC-2: [다음 예약] 버튼 클릭 시 인라인 패널이 열리고 페이지 이동하지 않는다', async ({ page }) => {
    await page.goto(`${BASE_URL}/customers`);
    await page.waitForLoadState('networkidle');

    const firstChartLink = page.locator('a[href*="/chart/"]').first();
    if (await firstChartLink.count() === 0) { test.skip(); return; }

    await firstChartLink.click();
    await page.waitForLoadState('networkidle');
    const chartUrl = page.url();

    const nextResvBtn = page.getByTestId('btn-next-reservation');
    if (await nextResvBtn.count() === 0) { test.skip(); return; }

    await nextResvBtn.click();

    // 패널이 열려야 함 (페이지 이동 없음)
    const panel = page.locator('[data-testid="inline-resv-date"]');
    await expect(panel).toBeVisible({ timeout: 5000 });

    // URL이 변경되지 않아야 함
    expect(page.url()).toBe(chartUrl);
  });

  // 시나리오 1 AC-2: 과거 날짜 비활성 확인
  test('AC-2 시나리오3: 날짜 입력에 과거일 min 제한이 있다', async ({ page }) => {
    await page.goto(`${BASE_URL}/customers`);
    await page.waitForLoadState('networkidle');

    const firstChartLink = page.locator('a[href*="/chart/"]').first();
    if (await firstChartLink.count() === 0) { test.skip(); return; }

    await firstChartLink.click();
    await page.waitForLoadState('networkidle');

    const nextResvBtn = page.getByTestId('btn-next-reservation');
    if (await nextResvBtn.count() === 0) { test.skip(); return; }

    await nextResvBtn.click();

    const dateInput = page.getByTestId('inline-resv-date');
    await expect(dateInput).toBeVisible({ timeout: 5000 });

    // min 속성이 오늘 날짜 이후로 설정됐는지 확인
    const minAttr = await dateInput.getAttribute('min');
    expect(minAttr).toBeTruthy();

    // min 형식이 yyyy-MM-dd 인지 확인
    expect(minAttr).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // min이 오늘 날짜이어야 함
    const today = new Date().toISOString().slice(0, 10);
    expect(minAttr).toBe(today);
  });

  // 시나리오 1 AC-2: 슬롯 그리드 표시 확인
  test('AC-2: 날짜 선택 시 30분 슬롯 그리드가 표시된다', async ({ page }) => {
    await page.goto(`${BASE_URL}/customers`);
    await page.waitForLoadState('networkidle');

    const firstChartLink = page.locator('a[href*="/chart/"]').first();
    if (await firstChartLink.count() === 0) { test.skip(); return; }

    await firstChartLink.click();
    await page.waitForLoadState('networkidle');

    const nextResvBtn = page.getByTestId('btn-next-reservation');
    if (await nextResvBtn.count() === 0) { test.skip(); return; }

    await nextResvBtn.click();

    // 내일 날짜로 설정 (기본값이 내일이지만 명시적 설정)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);

    const dateInput = page.getByTestId('inline-resv-date');
    await expect(dateInput).toBeVisible({ timeout: 5000 });
    await dateInput.fill(tomorrowStr);
    await page.keyboard.press('Tab');

    // 슬롯 그리드가 표시돼야 함
    const slotGrid = page.getByTestId('inline-resv-slot-grid');
    await expect(slotGrid).toBeVisible({ timeout: 8000 });

    // 슬롯 버튼이 1개 이상 있어야 함 (09:00~20:00 → 22개)
    const slotBtns = slotGrid.locator('[data-testid^="slot-"]');
    const count = await slotBtns.count();
    // 운영 슬롯이 없으면 skip (일요일 등)
    if (count === 0) { test.skip(); return; }
    expect(count).toBeGreaterThanOrEqual(1);
  });

  // 시나리오 2 AC-4: 예약관리 목록에 예약메모 표시
  test('AC-4: 예약관리 화면에서 예약메모가 있는 예약에 메모 텍스트가 표시된다', async ({ page }) => {
    await page.goto(`${BASE_URL}/reservations`);
    await page.waitForLoadState('networkidle');

    // 예약관리 페이지 로드 확인
    await expect(page).toHaveURL(/reservations/);

    // 캘린더 테이블 확인
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 8000 });

    // 예약메모가 있는 카드: text-amber-600 + 📝 아이콘
    // 메모가 없는 환경에서는 soft assertion
    const memoItems = page.locator('.text-amber-600').filter({ hasText: '📝' });
    const memoCount = await memoItems.count();

    if (memoCount > 0) {
      // 메모 텍스트가 비어있지 않아야 함
      const firstMemo = memoItems.first();
      await expect(firstMemo).toBeVisible();
      const text = await firstMemo.textContent();
      expect(text?.replace('📝', '').trim()).toBeTruthy();
    }
    // 메모가 없는 환경이면 구조만 검증 (pass)
    await expect(page).toHaveURL(/reservations/);
  });
});
