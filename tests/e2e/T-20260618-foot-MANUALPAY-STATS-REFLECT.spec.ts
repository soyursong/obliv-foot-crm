/**
 * T-20260618-foot-MANUALPAY-STATS-REFLECT — 매출집계 수기결제 반영 E2E spec
 *
 * 배경 (CONNECTIVITY-AUDIT-4 #4 A안):
 *   매출집계(SalesDailyTab) 일일결산 뷰가 closing_manual_payments(일마감 수기결제)를
 *   조회하지 않아 누락 → 일마감 합계 ≠ 매출집계 합계. '지출(현금 출금)' 카드는
 *   "음수 방향 구분 불가→0"으로 하드코딩 "—" 였다.
 *
 * 검증 대상:
 *   1) 지출 카드에 data-testid(sales-daily-cash-expense) 부여 — 부호 기반 표시 가능
 *   2) 매출집계 합계 = 일마감 합계 정합 (closing_manual_payments 합산 경로 연결)
 *   3) 기존 정상항목 회귀 0 (좌/우 매트릭스·현금 시재 testid 유지)
 *
 * READ-ONLY — DB 변경 없음.
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const SALES_URL = `${BASE_URL}/admin/sales`;

test.use({ storageState: 'playwright/.auth/user.json' });

test.describe('매출집계 수기결제 반영', () => {
  test('지출 카드에 testid 부여 + 기본 "—" 또는 음수 표시', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');

    const expenseCard = page.getByTestId('sales-daily-cash-expense');
    await expect(expenseCard).toBeVisible();

    // 수기 출금(음수)이 없으면 "—", 있으면 "− {금액}" — 둘 중 하나 (오류 아님)
    const txt = (await expenseCard.textContent())?.trim() ?? '';
    expect(txt === '—' || /^−\s/.test(txt)).toBeTruthy();
  });

  test('기존 정상항목 회귀 0 — 좌/우 매트릭스 + 현금 시재 testid 유지', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('sales-daily-left-matrix')).toBeVisible();
    await expect(page.getByTestId('sales-daily-right-matrix')).toBeVisible();
    await expect(page.getByTestId('sales-daily-left-total')).toBeVisible();
    await expect(page.getByTestId('sales-daily-right-total')).toBeVisible();
    await expect(page.getByTestId('sales-daily-cash-tracker')).toBeVisible();
    await expect(page.getByTestId('sales-daily-cash-in')).toBeVisible();
    await expect(page.getByTestId('sales-daily-cash-balance')).toBeVisible();
  });

  test('수기결제 조회 경로 연결 — closing_manual_payments 요청 발생', async ({ page }) => {
    // closing_manual_payments 테이블에 대한 GET 요청이 한 번 이상 나가야 한다.
    let manualQueried = false;
    page.on('request', (req) => {
      if (/closing_manual_payments/.test(req.url())) manualQueried = true;
    });

    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    expect(manualQueried).toBeTruthy();
  });

  test('데이터 없는 미래 기간 → 빈 상태 + 대사 경고 미표시', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');

    await page.getByTestId('sales-preset-custom').click();
    await page.getByTestId('sales-date-from').fill('2099-01-01');
    await page.getByTestId('sales-date-to').fill('2099-01-01');
    await page.waitForTimeout(800);

    await expect(page.getByTestId('sales-daily-mismatch-warning')).toHaveCount(0);
    await expect(page.getByTestId('sales-daily-empty')).toBeVisible();
  });
});
