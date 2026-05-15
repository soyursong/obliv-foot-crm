/**
 * T-20260515-foot-SALES-TAB-TREATMENT — 시술별 통계 E2E spec
 *
 * 검증 대상:
 *   시나리오 1: [시술별] 탭 클릭 → 대분류 아코디언 or 빈 상태 렌더 (AC-1)
 *   시나리오 2: 대분류 아코디언 펼치기 → 소분류 항목 표시 (AC-1)
 *   시나리오 3: 매출 비중 + 전체 합계 표시 (AC-2)
 *   AC-3: 복합 결제 안분 — 집계 총액 ≤ 결제 총액 (READ-ONLY 검증)
 *   AC-4: 글로벌 필터 + 미래 날짜 빈 상태
 *
 * READ-ONLY — DB 변경 없음.
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const SALES_URL = `${BASE_URL}/admin/sales`;

test.use({ storageState: 'playwright/.auth/user.json' });

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 시술별 탭 기본 렌더 (AC-1)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시술별 탭 기본 렌더 (AC-1)', () => {
  test('[시술별] 탭 클릭 → sales-treatment-tab 또는 빈 상태 표시', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');

    await page.getByRole('tab', { name: /시술별/ }).click();
    await page.waitForLoadState('networkidle');

    // 탭 활성 상태 확인
    await expect(page.getByRole('tab', { name: /시술별/ })).toHaveAttribute(
      'data-state',
      'active',
    );

    // 컨테이너 또는 empty 중 하나 표시
    const tab = page.getByTestId('sales-treatment-tab');
    const empty = page.getByTestId('sales-treatment-empty');
    const hasTab = await tab.isVisible().catch(() => false);
    const hasEmpty = await empty.isVisible().catch(() => false);
    expect(hasTab || hasEmpty).toBe(true);
  });

  test('[이번달] 기간 선택 후 시술별 탭 → 오류 없이 렌더', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');

    // 이번달로 범위 넓힘 (데이터 있을 가능성 높임)
    await page.getByTestId('sales-preset-month').click();
    await page.waitForLoadState('networkidle');

    await page.getByRole('tab', { name: /시술별/ }).click();
    await page.waitForLoadState('networkidle');

    const tab = page.getByTestId('sales-treatment-tab');
    const empty = page.getByTestId('sales-treatment-empty');
    const hasTab = await tab.isVisible().catch(() => false);
    const hasEmpty = await empty.isVisible().catch(() => false);
    expect(hasTab || hasEmpty).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 대분류 아코디언 토글 (AC-1)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('대분류 아코디언 토글 (AC-1)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');
    await page.getByTestId('sales-preset-month').click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /시술별/ }).click();
    await page.waitForLoadState('networkidle');
  });

  test('첫 번째 대분류 버튼 클릭 → 소분류 항목 표시', async ({ page }) => {
    const isEmpty = await page.getByTestId('sales-treatment-empty').isVisible().catch(() => false);
    if (isEmpty) {
      test.skip(true, '해당 기간 시술 데이터 없음 — 아코디언 테스트 스킵');
      return;
    }

    // 첫 번째 대분류 버튼 클릭
    const firstCatBtn = page
      .getByTestId('sales-treatment-tab')
      .locator('[data-testid^="sales-treatment-category-btn-"]')
      .first();

    await firstCatBtn.click();

    // aria-expanded="true" 확인
    await expect(firstCatBtn).toHaveAttribute('aria-expanded', 'true');

    // 소분류 items 컨테이너 표시 확인
    const itemsContainer = page
      .getByTestId('sales-treatment-tab')
      .locator('[data-testid^="sales-treatment-category-items-"]')
      .first();
    await expect(itemsContainer).toBeVisible();
  });

  test('대분류 두 번 클릭 → 접기 (토글)', async ({ page }) => {
    const isEmpty = await page.getByTestId('sales-treatment-empty').isVisible().catch(() => false);
    if (isEmpty) {
      test.skip(true, '해당 기간 시술 데이터 없음 — 접기 테스트 스킵');
      return;
    }

    const firstCatBtn = page
      .getByTestId('sales-treatment-tab')
      .locator('[data-testid^="sales-treatment-category-btn-"]')
      .first();

    // 펼치기
    await firstCatBtn.click();
    await expect(firstCatBtn).toHaveAttribute('aria-expanded', 'true');

    // 접기
    await firstCatBtn.click();
    await expect(firstCatBtn).toHaveAttribute('aria-expanded', 'false');
  });

  test('대분류 헤더에 건수 표시 (N건 형식)', async ({ page }) => {
    const isEmpty = await page.getByTestId('sales-treatment-empty').isVisible().catch(() => false);
    if (isEmpty) {
      test.skip(true, '해당 기간 시술 데이터 없음 — 건수 표시 테스트 스킵');
      return;
    }

    const firstCatBtn = page
      .getByTestId('sales-treatment-tab')
      .locator('[data-testid^="sales-treatment-category-btn-"]')
      .first();

    const text = await firstCatBtn.textContent();
    // "N건" 형식 포함 여부
    expect(text).toMatch(/\d+건/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 매출 비중 + 전체 합계 (AC-2)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('매출 비중 + 전체 합계 (AC-2)', () => {
  test('전체 합계 표시 (sales-treatment-total)', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');
    await page.getByTestId('sales-preset-month').click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /시술별/ }).click();
    await page.waitForLoadState('networkidle');

    const isEmpty = await page.getByTestId('sales-treatment-empty').isVisible().catch(() => false);
    if (isEmpty) {
      test.skip(true, '해당 기간 시술 데이터 없음 — 합계 테스트 스킵');
      return;
    }

    await expect(page.getByTestId('sales-treatment-total')).toBeVisible();
    const totalText = await page.getByTestId('sales-treatment-total').textContent();
    expect(totalText).toContain('전체 합계');
    // "원" 단위 포함 확인
    expect(totalText).toMatch(/원/);
  });

  test('매출 비중 % 표시 — 대분류 헤더에 N.N% 포함', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');
    await page.getByTestId('sales-preset-month').click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /시술별/ }).click();
    await page.waitForLoadState('networkidle');

    const isEmpty = await page.getByTestId('sales-treatment-empty').isVisible().catch(() => false);
    if (isEmpty) {
      test.skip(true, '해당 기간 시술 데이터 없음 — 비중 표시 테스트 스킵');
      return;
    }

    const firstCatBtn = page
      .getByTestId('sales-treatment-tab')
      .locator('[data-testid^="sales-treatment-category-btn-"]')
      .first();

    const text = await firstCatBtn.textContent();
    // "N.N%" 형식 포함 여부
    expect(text).toMatch(/\d+\.\d+%/);
  });

  test('mock — 단일 시술 결제 시 비중 100.0% 표시', async ({ page }) => {
    // mock으로 단일 시술 결제 주입
    const singlePayment = {
      id: 'mock-uuid-001',
      amount: 60000,
      payment_type: 'payment',
      status: 'completed',
      accounting_date: '2026-05-15',
      check_ins: {
        check_in_services: [
          {
            price: 60000,
            services: { name: '발톱무좀레이저', category: 'A001', category_label: '레이저치료' },
          },
        ],
      },
    };

    await page.route('**/rest/v1/payments**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([singlePayment]),
      }),
    );

    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /시술별/ }).click();
    await page.waitForLoadState('networkidle');

    // 탭 표시 확인
    await expect(page.getByTestId('sales-treatment-tab')).toBeVisible({ timeout: 5000 });

    // 레이저치료 카테고리 표시 확인
    await expect(page.getByTestId('sales-treatment-tab')).toContainText('레이저치료');

    // 100.0% 표시 확인
    await expect(page.getByTestId('sales-treatment-tab')).toContainText('100.0%');

    // 전체 합계 60,000원 표시
    await expect(page.getByTestId('sales-treatment-total')).toContainText('60,000');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 4: 복합 결제 안분 검증 (AC-3)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('복합 결제 안분 (AC-3)', () => {
  test('mock — 복합결제(2시술) 안분 합계 = 원 결제금액', async ({ page }) => {
    // 결제 60,000원 / 시술 2개 (30,000 + 30,000) → 각 50% 안분
    const compositePayment = {
      id: 'mock-uuid-002',
      amount: 60000,
      payment_type: 'payment',
      status: 'completed',
      accounting_date: '2026-05-15',
      check_ins: {
        check_in_services: [
          {
            price: 30000,
            services: { name: '프리컨디셔닝', category: 'B001', category_label: '전처치' },
          },
          {
            price: 30000,
            services: { name: '발톱무좀레이저', category: 'A001', category_label: '레이저치료' },
          },
        ],
      },
    };

    await page.route('**/rest/v1/payments**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([compositePayment]),
      }),
    );

    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /시술별/ }).click();
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('sales-treatment-tab')).toBeVisible({ timeout: 5000 });

    // 전체 합계 = 60,000 (안분 후 합계 보존)
    const total = page.getByTestId('sales-treatment-total');
    await expect(total).toContainText('60,000');

    // 각 카테고리 50.0% 표시
    const tab = page.getByTestId('sales-treatment-tab');
    const texts = await tab.textContent();
    // 50.0% 가 2번 등장해야 함 (두 카테고리 각각)
    const pctMatches = (texts ?? '').match(/50\.0%/g);
    expect(pctMatches?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  test('mock — 비대칭 안분 (price 1:3 비율)', async ({ page }) => {
    // 결제 80,000원 / 시술 2개 (20,000 + 60,000) → 25% + 75%
    const asymPayment = {
      id: 'mock-uuid-003',
      amount: 80000,
      payment_type: 'payment',
      status: 'completed',
      accounting_date: '2026-05-15',
      check_ins: {
        check_in_services: [
          {
            price: 20000,
            services: { name: '상담', category: 'C001', category_label: '상담' },
          },
          {
            price: 60000,
            services: { name: '레이저치료', category: 'A001', category_label: '레이저치료' },
          },
        ],
      },
    };

    await page.route('**/rest/v1/payments**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([asymPayment]),
      }),
    );

    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /시술별/ }).click();
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('sales-treatment-tab')).toBeVisible({ timeout: 5000 });

    // 전체 합계 = 80,000
    await expect(page.getByTestId('sales-treatment-total')).toContainText('80,000');

    // 레이저치료 카테고리 75.0%
    const tab = page.getByTestId('sales-treatment-tab');
    await expect(tab).toContainText('75.0%');
    // 상담 카테고리 25.0%
    await expect(tab).toContainText('25.0%');
  });

  test('mock — 환불 건 음수 기여액 처리', async ({ page }) => {
    const refundPayment = {
      id: 'mock-uuid-004',
      amount: 50000,
      payment_type: 'refund',
      status: 'refunded',
      accounting_date: '2026-05-15',
      check_ins: {
        check_in_services: [
          {
            price: 50000,
            services: { name: '발톱무좀레이저', category: 'A001', category_label: '레이저치료' },
          },
        ],
      },
    };

    await page.route('**/rest/v1/payments**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([refundPayment]),
      }),
    );

    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /시술별/ }).click();
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('sales-treatment-tab')).toBeVisible({ timeout: 5000 });

    // 음수 합계 표시 — "−50,000" 또는 "-50,000" 형식
    const total = page.getByTestId('sales-treatment-total');
    const totalText = await total.textContent();
    expect(totalText).toMatch(/-.*50,000|50,000.*-/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4: 글로벌 필터 + 빈 상태
// ─────────────────────────────────────────────────────────────────────────────
test.describe('글로벌 필터 + 빈 상태 (AC-4)', () => {
  test('미래 날짜 직접입력 → 빈 상태 표시', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /시술별/ }).click();
    await page.waitForLoadState('networkidle');

    await page.getByTestId('sales-preset-custom').click();
    await page.getByTestId('sales-date-from').fill('2099-01-01');
    await page.getByTestId('sales-date-to').fill('2099-01-01');
    await page.waitForTimeout(800);

    await expect(page.getByTestId('sales-treatment-empty')).toBeVisible();
    await expect(page.getByTestId('sales-treatment-empty')).toContainText('시술 데이터가 없습니다');
  });

  test('공통 필터바 표시 + 시술별 탭 공존', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /시술별/ }).click();
    await page.waitForLoadState('networkidle');

    // 필터바 공존 확인
    await expect(page.getByTestId('sales-filter-bar')).toBeVisible();
    // 탭 활성 확인
    await expect(page.getByRole('tab', { name: /시술별/ })).toHaveAttribute('data-state', 'active');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 회귀: 기존 탭 미영향
// ─────────────────────────────────────────────────────────────────────────────
test('회귀: 시술별 탭 접근 후 일일결산 탭 정상 복귀', async ({ page }) => {
  await page.goto(SALES_URL);
  await page.waitForLoadState('networkidle');

  // 시술별 탭 → 일일결산 탭 복귀
  await page.getByRole('tab', { name: /시술별/ }).click();
  await page.waitForLoadState('networkidle');
  await page.getByRole('tab', { name: /일일결산/ }).click();
  await page.waitForLoadState('networkidle');

  // 일일결산 탭 활성 확인
  await expect(page.getByRole('tab', { name: /일일결산/ })).toHaveAttribute('data-state', 'active');
});

test('회귀: Dashboard 정상 접근', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await page.waitForLoadState('networkidle');
  await expect(page).not.toHaveURL(/error|login/);
});
