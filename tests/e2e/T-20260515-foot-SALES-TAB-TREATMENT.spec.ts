/**
 * T-20260515-foot-SALES-TAB-TREATMENT — 시술 종류별 매출 E2E spec
 * T-20260725-foot-SALES-TREATMENT-TAB-WHITELIST6 — 화이트리스트 6개 버킷 재정비 반영
 *
 * 검증 대상:
 *   시나리오 1: [시술별] 탭 클릭 → 버킷 아코디언 or 빈 상태 렌더 (AC-1)
 *   시나리오 2: 버킷 헤더 클릭 → 소분류 항목 표시 (AC-1)
 *   시나리오 3: 매출 비중 + 전체 합계 표시 (AC-2)
 *   AC-3: 복합 결제 안분 — 집계 총액 = 결제 총액
 *   AC-4: 글로벌 필터 + 미래 날짜 빈 상태
 *   WHITELIST6: 6개 버킷만 표기 / 6개 이외(수액 등) 제외(숨김) / 리본=Reborn(각질) 매칭
 *
 * READ-ONLY — DB 변경 없음.
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const SALES_URL = `${BASE_URL}/admin/sales`;

test.use({ storageState: 'playwright/.auth/user.json' });

// 화이트리스트 6개 버킷 testid suffix (고정 순서)
const BUCKET_IDS = ['unheated', 'heated', 'podologue', 'reborn', 'cosmetic', 'consult'] as const;

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 시술별 탭 기본 렌더 (AC-1)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시술별 탭 기본 렌더 (AC-1)', () => {
  test('[시술별] 탭 클릭 → sales-treatment-tab 또는 빈 상태 표시', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');

    await page.getByRole('tab', { name: /시술별/ }).click();
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('tab', { name: /시술별/ })).toHaveAttribute(
      'data-state',
      'active',
    );

    const tab = page.getByTestId('sales-treatment-tab');
    const empty = page.getByTestId('sales-treatment-empty');
    const hasTab = await tab.isVisible().catch(() => false);
    const hasEmpty = await empty.isVisible().catch(() => false);
    expect(hasTab || hasEmpty).toBe(true);
  });

  test('[이번달] 기간 선택 후 시술별 탭 → 오류 없이 렌더', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');

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
// WHITELIST6: 데이터 존재 시 정확히 6개 버킷만 표기 (고정 순서/표시명)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('화이트리스트 6개 버킷만 표기 (WHITELIST6)', () => {
  // 6개 버킷 각 1건 + 화이트리스트 제외 대상(수액) 1건 mock
  const mixedPayments = [
    { id: 'wl-01', amount: 100000, name: '비가열레이저 - 아톰', category: '풋케어', category_label: '풋케어' },
    { id: 'wl-02', amount: 90000, name: '가열성 진균증 레이저 치료', category: '풋케어', category_label: '풋케어' },
    { id: 'wl-03', amount: 80000, name: '포돌로게(내성발톱 치료의료기기)', category: '풋케어', category_label: '풋케어' },
    { id: 'wl-04', amount: 70000, name: '리본 에센셜(각질)', category: '풋케어', category_label: '풋케어' },
    { id: 'wl-05', amount: 60000, name: '풋샴푸 (200ml)', category: '풋화장품', category_label: '풋화장품' },
    { id: 'wl-06', amount: 50000, name: '초진진찰료-의원', category: '기본', category_label: '기본' },
    // 화이트리스트 제외 대상 — 이 탭에 표기되면 안 됨
    { id: 'wl-ex1', amount: 40000, name: '재생수액', category: '수액', category_label: '수액' },
  ].map((r) => ({
    id: r.id,
    amount: r.amount,
    payment_type: 'payment',
    status: 'completed',
    accounting_date: '2026-05-15',
    check_ins: {
      check_in_services: [
        { price: r.amount, services: { name: r.name, category: r.category, category_label: r.category_label } },
      ],
    },
  }));

  test.beforeEach(async ({ page }) => {
    await page.route('**/rest/v1/payments**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mixedPayments),
      }),
    );
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /시술별/ }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('sales-treatment-tab')).toBeVisible({ timeout: 5000 });
  });

  test('정확히 6개 버킷 헤더만 렌더 (수액 등 제외)', async ({ page }) => {
    const btns = page
      .getByTestId('sales-treatment-tab')
      .locator('[data-testid^="sales-treatment-category-btn-"]');
    await expect(btns).toHaveCount(6);

    for (const id of BUCKET_IDS) {
      await expect(page.getByTestId(`sales-treatment-category-btn-${id}`)).toBeVisible();
    }
  });

  test('6개 버킷 표시명 노출 + 수액 항목 미표기', async ({ page }) => {
    const tab = page.getByTestId('sales-treatment-tab');
    for (const label of [
      '비가열레이저',
      '가열레이저',
      '포돌로게(내성)',
      'Reborn(각질)',
      '풋화장품',
      '진찰료(기본/서류/검사비)',
    ]) {
      await expect(tab).toContainText(label);
    }
    // 화이트리스트 제외 항목 미표기 검증
    await expect(tab).not.toContainText('재생수액');
    await expect(tab).not.toContainText('수액');
  });

  test('버킷 순서 고정 = [비가열|가열|포돌로게|Reborn|풋화장품|진찰료]', async ({ page }) => {
    const ids = await page
      .getByTestId('sales-treatment-tab')
      .locator('[data-testid^="sales-treatment-category-btn-"]')
      .evaluateAll((els) =>
        els.map((e) => e.getAttribute('data-testid')?.replace('sales-treatment-category-btn-', '')),
      );
    expect(ids).toEqual(['unheated', 'heated', 'podologue', 'reborn', 'cosmetic', 'consult']);
  });

  test('전체 합계 = 6개 버킷 합산 (수액 40,000 제외 → 450,000)', async ({ page }) => {
    // 100k+90k+80k+70k+60k+50k = 450,000 (수액 40k 제외)
    await expect(page.getByTestId('sales-treatment-total')).toContainText('450,000');
  });

  test('Reborn(각질) 버킷 = DB 실제값 "리본" 매칭 (매칭 누락 0)', async ({ page }) => {
    const rebornBtn = page.getByTestId('sales-treatment-category-btn-reborn');
    // 1건 집계 확인 (리본 에센셜)
    await expect(rebornBtn).toContainText('1건');
    await expect(rebornBtn).toContainText('70,000');
    // 펼치면 실제 시술명 노출
    await rebornBtn.click();
    await expect(page.getByTestId('sales-treatment-category-items-reborn')).toContainText('리본 에센셜(각질)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 버킷 아코디언 토글 (AC-1)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('버킷 아코디언 토글 (AC-1)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');
    await page.getByTestId('sales-preset-month').click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /시술별/ }).click();
    await page.waitForLoadState('networkidle');
  });

  test('데이터 있는 버킷 클릭 → 소분류 항목 표시', async ({ page }) => {
    const isEmpty = await page.getByTestId('sales-treatment-empty').isVisible().catch(() => false);
    if (isEmpty) {
      test.skip(true, '해당 기간 시술 데이터 없음 — 아코디언 테스트 스킵');
      return;
    }

    // 활성(데이터 있는=미disabled) 버킷 버튼 중 첫 번째
    const enabledBtn = page
      .getByTestId('sales-treatment-tab')
      .locator('[data-testid^="sales-treatment-category-btn-"]:not([disabled])')
      .first();

    const cnt = await enabledBtn.count();
    if (cnt === 0) {
      test.skip(true, '표기 버킷에 데이터 없음 — 스킵');
      return;
    }

    await enabledBtn.click();
    await expect(enabledBtn).toHaveAttribute('aria-expanded', 'true');

    const itemsContainer = page
      .getByTestId('sales-treatment-tab')
      .locator('[data-testid^="sales-treatment-category-items-"]')
      .first();
    await expect(itemsContainer).toBeVisible();
  });

  test('버킷 두 번 클릭 → 접기 (토글)', async ({ page }) => {
    const isEmpty = await page.getByTestId('sales-treatment-empty').isVisible().catch(() => false);
    if (isEmpty) {
      test.skip(true, '해당 기간 시술 데이터 없음 — 접기 테스트 스킵');
      return;
    }

    const enabledBtn = page
      .getByTestId('sales-treatment-tab')
      .locator('[data-testid^="sales-treatment-category-btn-"]:not([disabled])')
      .first();
    if ((await enabledBtn.count()) === 0) {
      test.skip(true, '표기 버킷에 데이터 없음 — 스킵');
      return;
    }

    await enabledBtn.click();
    await expect(enabledBtn).toHaveAttribute('aria-expanded', 'true');
    await enabledBtn.click();
    await expect(enabledBtn).toHaveAttribute('aria-expanded', 'false');
  });

  test('버킷 헤더에 건수 표시 (N건 형식)', async ({ page }) => {
    const isEmpty = await page.getByTestId('sales-treatment-empty').isVisible().catch(() => false);
    if (isEmpty) {
      test.skip(true, '해당 기간 시술 데이터 없음 — 건수 표시 테스트 스킵');
      return;
    }

    const firstBtn = page
      .getByTestId('sales-treatment-tab')
      .locator('[data-testid^="sales-treatment-category-btn-"]')
      .first();

    const text = await firstBtn.textContent();
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
    expect(totalText).toMatch(/원/);
  });

  test('mock — 단일 시술(비가열레이저) 결제 시 비중 100.0% 표시', async ({ page }) => {
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
            services: { name: '비가열레이저 - 아톰', category: '풋케어', category_label: '풋케어' },
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

    await expect(page.getByTestId('sales-treatment-tab')).toBeVisible({ timeout: 5000 });
    // 비가열레이저 버킷 표시
    await expect(page.getByTestId('sales-treatment-tab')).toContainText('비가열레이저');
    // 100.0% 표시
    await expect(page.getByTestId('sales-treatment-category-btn-unheated')).toContainText('100.0%');
    // 전체 합계 60,000원
    await expect(page.getByTestId('sales-treatment-total')).toContainText('60,000');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 4: 복합 결제 안분 검증 (AC-3)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('복합 결제 안분 (AC-3)', () => {
  test('mock — 복합결제(비가열+가열) 안분 합계 = 원 결제금액', async ({ page }) => {
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
            services: { name: '비가열레이저 - 아톰', category: '풋케어', category_label: '풋케어' },
          },
          {
            price: 30000,
            services: { name: '가열성 진균증 레이저 치료', category: '풋케어', category_label: '풋케어' },
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
    await expect(page.getByTestId('sales-treatment-total')).toContainText('60,000');

    // 비가열/가열 각각 50.0%
    await expect(page.getByTestId('sales-treatment-category-btn-unheated')).toContainText('50.0%');
    await expect(page.getByTestId('sales-treatment-category-btn-heated')).toContainText('50.0%');
  });

  test('mock — 비대칭 안분 (price 1:3 비율, 진찰료+비가열)', async ({ page }) => {
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
            services: { name: '초진진찰료-의원', category: '기본', category_label: '기본' },
          },
          {
            price: 60000,
            services: { name: '비가열레이저 - 아톰', category: '풋케어', category_label: '풋케어' },
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

    await expect(page.getByTestId('sales-treatment-total')).toContainText('80,000');
    // 비가열 75.0%
    await expect(page.getByTestId('sales-treatment-category-btn-unheated')).toContainText('75.0%');
    // 진찰료 25.0%
    await expect(page.getByTestId('sales-treatment-category-btn-consult')).toContainText('25.0%');
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
            services: { name: '비가열레이저 - 아톰', category: '풋케어', category_label: '풋케어' },
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

    await expect(page.getByTestId('sales-filter-bar')).toBeVisible();
    await expect(page.getByRole('tab', { name: /시술별/ })).toHaveAttribute('data-state', 'active');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 회귀: 기존 탭 미영향
// ─────────────────────────────────────────────────────────────────────────────
test('회귀: 시술별 탭 접근 후 일일결산 탭 정상 복귀', async ({ page }) => {
  await page.goto(SALES_URL);
  await page.waitForLoadState('networkidle');

  await page.getByRole('tab', { name: /시술별/ }).click();
  await page.waitForLoadState('networkidle');
  await page.getByRole('tab', { name: /일일결산/ }).click();
  await page.waitForLoadState('networkidle');

  await expect(page.getByRole('tab', { name: /일일결산/ })).toHaveAttribute('data-state', 'active');
});

test('회귀: Dashboard 정상 접근', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await page.waitForLoadState('networkidle');
  await expect(page).not.toHaveURL(/error|login/);
});
