/**
 * T-20260717-foot-CLOSING-CHARTNUM-POPUP (P2)
 *   (supersedes T-20260715-foot-CLOSING-CHARTNUM-CHARTNAV — same-window navigate → window.open 팝업)
 *
 * 일마감(결제내역) 탭의 차트번호 셀 클릭 → 고객 2번차트(/chart/:customerId)를 별도 팝업창(새 창)으로 표출.
 *  - row_customer_id 있는 행(단건·패키지 결제): 셀 클릭 활성 + cursor-pointer/hover:underline,
 *    클릭 시 window.open(`/chart/${row_customer_id}`, ..., 'noopener') → 새 창 오픈.
 *    ★ 일마감 화면은 그대로 유지(사라지지 않음).
 *  - 수기(source=manual) 행(row_customer_id 없음): 클릭/hover 비활성.
 *
 * 전부 재사용: cn(L53), route /chart/:customerId(App.tsx L181). DB변경 없음.
 *   (navigate → window.open 팝업 방식, 김주연 총괄 요청. NEW-TASK MSG-20260717-151418-oj4g.
 *    현행 navigate는 일마감 화면이 사라지는 문제 → 별도 창으로 변경.)
 *
 * AC:
 *  - AC-1: row_customer_id 있는 행의 차트번호 셀은 cursor-pointer 클래스를 가진다.
 *  - AC-2(수정): 해당 셀 클릭 시 /chart/<uuid> 가 별도 팝업창(새 page)으로 열리고,
 *          원래 일마감 화면(/admin/closing)은 그대로 유지된다.
 *  - AC-3: 수기 행(bg-sky-50)의 차트번호 셀은 cursor-pointer 클래스가 없고 클릭해도 창이 열리지 않는다.
 */
import { test, expect } from '@playwright/test';

async function openPaymentsTab(page) {
  await page.goto('/admin/closing');
  await page.waitForSelector('table', { timeout: 30000 });
  await page.getByRole('tab', { name: /결제내역/ }).click();
  await page.waitForTimeout(2000);
}

test.describe('CLOSING-CHARTNUM-CHARTNAV', () => {
  // 정상 시나리오 (AC-1 + AC-2): row_customer_id 있는 행 → 셀 활성 + 클릭 시 2번차트 팝업 + 일마감 유지
  test('scenario-1(정상): 결제행 차트번호 셀 클릭 → /chart/:customerId 팝업 오픈 + 일마감 화면 유지', async ({ page, context }) => {
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

    // AC-2(수정): 클릭 → 별도 팝업창(새 page)으로 /chart/<uuid> 오픈.
    //   window.open에 noopener 지정 → opener 관계가 끊겨 context의 새 page 이벤트로 잡힌다.
    const popupPromise = context.waitForEvent('page', { timeout: 15000 });
    await activeCell.click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    expect(popup.url()).toMatch(/\/chart\/[0-9a-f-]{8,}/i);

    // AC-2 핵심: 원래 일마감 화면은 그대로 유지(사라지지 않음).
    expect(page.url()).toMatch(/\/admin\/closing/);
    await expect(payTable).toBeVisible();

    await popup.close();
  });

  // 수기 엣지 시나리오 (AC-3): 수기 행(row_customer_id 없음) → 셀 비활성, 클릭해도 창 안 열림
  test('scenario-2(수기엣지): 수기 행 차트번호 셀은 비활성 — cursor-pointer 없음 + 클릭해도 팝업 미오픈', async ({ page, context }) => {
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

    // 클릭해도 팝업 미오픈 + 일마감 화면 유지
    const pagesBefore = context.pages().length;
    const before = page.url();
    await manualChartCell.click();
    await page.waitForTimeout(800);
    expect(context.pages().length).toBe(pagesBefore); // 새 창 안 열림
    expect(page.url()).toBe(before);
  });
});
