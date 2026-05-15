/**
 * T-20260515-foot-SALES-COMMON-DB — 매출집계 공통 레이어 E2E spec
 *
 * 검증 대상:
 *   1. 매출집계 페이지 접근 + 탭 셸 렌더
 *   2. SalesFilterBar: 프리셋 전환 + 직접입력 + 검색바
 *   3. 5개 탭 네비게이션 (placeholder 표시)
 *   4. 엑셀 다운로드 버튼 (빈 결과 toast 확인)
 *
 * GO_WARN 참조:
 *   DB 스키마 변경(accounting_date, claim_diagnoses 등)은
 *   migrations/20260515000010_sales_common_db.sql 로 별도 적용.
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const SALES_URL = `${BASE_URL}/admin/sales`;

test.use({ storageState: 'playwright/.auth/user.json' });

// ─────────────────────────────────────────────────────────────────────────────
// 1. 페이지 진입 + 탭 셸
// ─────────────────────────────────────────────────────────────────────────────
test.describe('매출집계 페이지 기본 렌더', () => {
  test('제목 + 필터바 + 5탭 표시', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: '매출집계' })).toBeVisible();
    await expect(page.getByTestId('sales-filter-bar')).toBeVisible();

    for (const label of ['일일결산', '환자별', '시술별', '담당의별', '담당직원별']) {
      await expect(page.getByRole('tab', { name: new RegExp(label) })).toBeVisible();
    }
  });

  test('기본 활성 탭은 일일결산', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('tab', { name: /일일결산/ })).toHaveAttribute(
      'data-state',
      'active',
    );
  });

  test('회계귀속일 기준 안내 문구 표시', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/accounting_date/)).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. SalesFilterBar — 기간 프리셋
// ─────────────────────────────────────────────────────────────────────────────
test.describe('SalesFilterBar — 기간 프리셋', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');
  });

  test('오늘 프리셋 클릭 → 버튼 활성', async ({ page }) => {
    const btn = page.getByTestId('sales-preset-today');
    await btn.click();
    await expect(btn).toHaveClass(/bg-teal-600/);
  });

  test('이번주 프리셋 전환', async ({ page }) => {
    const btn = page.getByTestId('sales-preset-week');
    await btn.click();
    await expect(btn).toHaveClass(/bg-teal-600/);
  });

  test('이번달 프리셋 전환', async ({ page }) => {
    const btn = page.getByTestId('sales-preset-month');
    await btn.click();
    await expect(btn).toHaveClass(/bg-teal-600/);
  });

  test('직접입력 클릭 시 날짜 input 두 개 표시', async ({ page }) => {
    await page.getByTestId('sales-preset-custom').click();
    await expect(page.getByTestId('sales-date-from')).toBeVisible();
    await expect(page.getByTestId('sales-date-to')).toBeVisible();
  });

  test('from 날짜 입력 시 to.min 동기화', async ({ page }) => {
    await page.getByTestId('sales-preset-custom').click();
    await page.getByTestId('sales-date-from').fill('2026-05-01');
    await expect(page.getByTestId('sales-date-to')).toHaveAttribute('min', '2026-05-01');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. SalesFilterBar — 검색바
// ─────────────────────────────────────────────────────────────────────────────
test.describe('SalesFilterBar — 검색바', () => {
  test('검색어 입력 + 표시', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');

    const searchInput = page.getByTestId('sales-search');
    await searchInput.fill('홍길동');
    await expect(searchInput).toHaveValue('홍길동');
  });

  test('검색어 입력 후 X 버튼으로 클리어', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');

    const searchInput = page.getByTestId('sales-search');
    await searchInput.fill('홍길동');

    // X 버튼 (clear button) — 검색바 안의 마지막 버튼
    const filterBar = page.getByTestId('sales-filter-bar');
    const clearBtn = filterBar.locator('button').last();
    await clearBtn.click();

    await expect(searchInput).toHaveValue('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. 탭 네비게이션 — placeholder 표시
// ─────────────────────────────────────────────────────────────────────────────
test.describe('탭 네비게이션', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');
  });

  test('일일결산 탭 placeholder 표시', async ({ page }) => {
    // 기본 탭 — 이미 active
    await expect(
      page.getByTestId('sales-placeholder-일일결산 (T-20260515-foot-SALES-TAB-DAILY)'),
    ).toBeVisible();
  });

  test('환자별 탭 클릭 → placeholder 표시', async ({ page }) => {
    await page.getByRole('tab', { name: /환자별/ }).click();
    await expect(
      page.getByTestId('sales-placeholder-환자별 (T-20260515-foot-SALES-TAB-PATIENT)'),
    ).toBeVisible();
  });

  test('시술별 탭 클릭 → placeholder 표시', async ({ page }) => {
    await page.getByRole('tab', { name: /시술별/ }).click();
    await expect(
      page.getByTestId('sales-placeholder-시술별 (T-20260515-foot-SALES-TAB-TREATMENT)'),
    ).toBeVisible();
  });

  test('담당의별 탭 클릭 → placeholder 표시', async ({ page }) => {
    await page.getByRole('tab', { name: /담당의별/ }).click();
    await expect(
      page.getByTestId('sales-placeholder-담당의별 (T-20260515-foot-SALES-TAB-DOCTOR)'),
    ).toBeVisible();
  });

  test('담당직원별 탭 클릭 → placeholder 표시', async ({ page }) => {
    await page.getByRole('tab', { name: /담당직원별/ }).click();
    await expect(
      page.getByTestId('sales-placeholder-담당직원별 (T-20260515-foot-SALES-TAB-STAFF)'),
    ).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. 엑셀 다운로드 버튼
// ─────────────────────────────────────────────────────────────────────────────
test.describe('엑셀 다운로드', () => {
  test('다운로드 버튼 렌더 + 활성 상태', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');

    const btn = page.getByTestId('sales-export-btn');
    await expect(btn).toBeVisible();
    await expect(btn).not.toBeDisabled();
  });

  test('빈 기간 조회 시 "내역이 없습니다" toast', async ({ page }) => {
    // Supabase 응답 mock: 빈 배열
    await page.route('**/rest/v1/payments**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route('**/rest/v1/package_payments**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );

    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');
    await page.getByTestId('sales-export-btn').click();

    await expect(page.getByText(/매출 내역이 없습니다/)).toBeVisible({ timeout: 5000 });
  });

  test('데이터 있을 때 다운로드 시 파일 emit', async ({ page }) => {
    const sampleRow = {
      id: 'test-uuid-001',
      accounting_date: '2026-05-15',
      origin_tx_date: '2026-05-15',
      payment_type: 'payment',
      status: 'completed',
      amount: 50000,
      method: 'card',
      tax_type: '면세_비급여',
      appr_info: 'KB카드 123456',
      exclude_tax_report: false,
      parent_payment_id: null,
      memo: null,
      created_at: '2026-05-15T10:00:00+09:00',
      check_ins: {
        visit_type: 'new',
        customer_name: '홍길동',
        customers: { chart_number: 'F-001' },
        check_in_services: [{ services: { name: '발톱무좀레이저', category: 'A001' } }],
        therapist: { name: '김치료사' },
        consultant: null,
      },
    };

    await page.route('**/rest/v1/payments**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([sampleRow]),
      }),
    );
    await page.route('**/rest/v1/package_payments**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );

    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');

    // 파일 다운로드 감지
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 8000 }),
      page.getByTestId('sales-export-btn').click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/매출집계.*\.xlsx$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. 회귀: 기존 페이지 미영향
// ─────────────────────────────────────────────────────────────────────────────
test('회귀: Dashboard 정상 접근', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await page.waitForLoadState('networkidle');
  await expect(page).not.toHaveURL(/error|login/);
});
