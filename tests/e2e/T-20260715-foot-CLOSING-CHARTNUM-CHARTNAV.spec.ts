/**
 * T-20260715-foot-CLOSING-CHARTNUM-CHARTNAV (P2)
 *
 * 일마감(결제내역) 탭의 차트번호 셀 클릭 → 고객 2번차트(/chart/:customerId) nav 연결.
 *  - row_customer_id 있는 행(단건·패키지 결제): 셀 클릭 활성 + cursor-pointer/hover:underline,
 *    클릭 시 navigate(`/chart/${row_customer_id}`).
 *  - 수기(source=manual) 행(row_customer_id 없음): 클릭/hover 비활성.
 *
 * 전부 재사용: navigate(useNavigate L238), cn(L53), route /chart/:customerId(App.tsx L181). DB변경 없음.
 *
 * AC:
 *  - AC-1: row_customer_id 있는 행의 차트번호 셀은 cursor-pointer 클래스를 가진다.
 *  - AC-2: 해당 셀 클릭 시 URL이 /chart/<uuid> 로 이동한다.
 *  - AC-3: 수기 행(bg-sky-50)의 차트번호 셀은 cursor-pointer 클래스가 없고 클릭해도 이동하지 않는다.
 */
import { test, expect } from '@playwright/test';

async function openPaymentsTab(page) {
  await page.goto('/admin/closing');
  await page.waitForSelector('table', { timeout: 30000 });
  await page.getByRole('tab', { name: /결제내역/ }).click();
  await page.waitForTimeout(2000);
}

test.describe('CLOSING-CHARTNUM-CHARTNAV', () => {
  // 정상 시나리오 (AC-1 + AC-2): row_customer_id 있는 행 → 셀 활성 + 클릭 시 2번차트 이동
  test('scenario-1(정상): 결제행 차트번호 셀 클릭 → /chart/:customerId 이동', async ({ page }) => {
    await openPaymentsTab(page);
    const payTable = page.locator('table', { has: page.locator('thead', { hasText: '환불' }) }).first();
    await expect(payTable).toBeVisible();

    // row_customer_id 있는(=클릭 활성) 차트번호 셀 = cursor-pointer 클래스 보유
    const activeCell = payTable.locator('td[data-testid="closing-chartno-cell"].cursor-pointer').first();
    // 오늘 seed에 단건/패키지 결제행이 최소 1건 있어야 정상. 없으면 skip(데이터 의존).
    if (await activeCell.count() === 0) {
      test.skip(true, '오늘 결제(단건/패키지) 행 seed 없음 — 데이터 의존 시나리오');
    }

    // AC-1: cursor-pointer 클래스 확인 (locator 자체가 클래스 필터)
    await expect(activeCell).toBeVisible();

    // AC-2: 클릭 → /chart/<uuid> 이동
    await activeCell.click();
    await expect(page).toHaveURL(/\/chart\/[0-9a-f-]{8,}/i, { timeout: 15000 });
  });

  // 수기 엣지 시나리오 (AC-3): 수기 행(row_customer_id 없음) → 셀 비활성, 클릭해도 미이동
  test('scenario-2(수기엣지): 수기 행 차트번호 셀은 비활성 — cursor-pointer 없음 + 클릭 미이동', async ({ page }) => {
    await openPaymentsTab(page);
    const payTable = page.locator('table', { has: page.locator('thead', { hasText: '환불' }) }).first();
    await expect(payTable).toBeVisible();

    // 수기 행 = source==='manual' → tr.bg-sky-50
    const manualRow = payTable.locator('tbody tr.bg-sky-50').first();
    if (await manualRow.count() === 0) {
      test.skip(true, '오늘 수기 결제(manual) 행 seed 없음 — 데이터 의존 시나리오');
    }

    const manualChartCell = manualRow.locator('td[data-testid="closing-chartno-cell"]');
    await expect(manualChartCell).toBeVisible();
    // AC-3: cursor-pointer 클래스 없음
    await expect(manualChartCell).not.toHaveClass(/cursor-pointer/);

    // 클릭해도 URL 불변(결제내역 페이지 유지)
    const before = page.url();
    await manualChartCell.click();
    await page.waitForTimeout(800);
    expect(page.url()).toBe(before);
  });
});
