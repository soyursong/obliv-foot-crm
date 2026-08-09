/**
 * T-20260806-foot-THERAPIST-DEDUCTCOUNT-CUSTLIST-DRILLDOWN
 * 매출집계 > 담당치료사별 '차감 건수' 클릭 → 차감 고객 리스트 팝업 → 고객 클릭 → 2번차트 이동
 *
 * 티켓 §현장 클릭 시나리오 2종 변환:
 *   시나리오 1(정상 동선): 차감 건수(≥1) 클릭 → 리스트 팝업(건수 == 차감 건수) →
 *                          행별 고객명·차트번호·차감 날짜·차감 항목 표시 → 고객 클릭 → 2번차트 오픈
 *   시나리오 2(엣지):      차감 건수 0 = 비활성(클릭 대상 아님) / 리스트 닫기 후 다른 치료사 재클릭 시 갱신
 *
 * AC 매핑:
 *   AC1 — '차감 건수' 셀(값 ≥1)이 클릭 가능(링크형 버튼)으로 표시
 *   AC2 — 클릭 시 차감 고객 리스트 팝업, 건수 = 표에 보이던 '차감 건수' (카운트-리스트 정합)
 *   AC3 — 리스트 각 행에 고객명·차트번호·차감 날짜·차감 항목(시술명) 표시
 *   AC4 — 리스트 고객 클릭 → 기존 2번차트 라우팅(useChart.openChart) 재사용
 *          (Playwright=navigator.webdriver → window.open 팝업 대신 in-page CustomerChartSheet 서랍 폴백)
 *   AC5 — 차감 건수 0 치료사는 비활성(버튼 없음) — 에러/빈 화면 없음
 *   AC6 — 차감건수 산식 불변(리스트는 동일 소스 deductSessions 파생) — 카운트-리스트 정합으로 간접 검증
 *
 * READ-ONLY — DB 변경 없음(집계 조회 + 기존 라우팅 재사용).
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const SALES_URL = `${BASE_URL}/admin/sales`;

test.use({ storageState: 'playwright/.auth/user.json' });

/** 담당치료사별 탭 진입 + 이번달 프리셋(차감기준 기본). */
async function gotoStaffTab(page: import('@playwright/test').Page) {
  await page.goto(SALES_URL);
  await page.waitForLoadState('networkidle');
  const staffTab = page.getByRole('tab', { name: /담당치료사별/ });
  await staffTab.waitFor({ state: 'visible', timeout: 15000 });
  await staffTab.click();
  await page.waitForLoadState('networkidle');
  // 이번달 프리셋 — 차감 데이터 폭을 넓혀 치료사 행 노출 가능성 ↑
  await page.getByTestId('sales-preset-month').click().catch(() => {});
  await page.waitForLoadState('networkidle');
  // 차감기준 토글이 기본이지만 명시적으로 보장(수납기준 잔류 방지)
  await page.getByTestId('sales-staff-basis-deduction').click().catch(() => {});
  await page.waitForLoadState('networkidle');
}

/** 클릭 가능한 '차감 건수' 버튼(값 ≥1) 중 첫 번째를 반환. 없으면 null. */
async function firstDeductCountButton(page: import('@playwright/test').Page) {
  const btn = page.locator('button[data-testid^="sales-staff-deduct-count-"]').first();
  const visible = await btn.isVisible().catch(() => false);
  return visible ? btn : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 정상 동선 (차감 건수 → 리스트 → 2번차트)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 1 — 차감 건수 drill-down → 2번차트', () => {
  test('담당치료사별 탭 진입 정상 렌더(에러 없음)', async ({ page }) => {
    await gotoStaffTab(page);
    await expect(page.getByRole('tab', { name: /담당치료사별/ })).toHaveAttribute(
      'data-state',
      'active',
    );
    const anyView = page
      .locator(
        '[data-testid="sales-staff-deduct-tab"], [data-testid="sales-staff-deduct-empty"]',
      )
      .first();
    await expect(anyView).toBeVisible();
  });

  test('AC1·AC2 — 차감 건수(≥1) 클릭 → 리스트 팝업, 건수 == 차감 건수', async ({ page }) => {
    await gotoStaffTab(page);

    const btn = await firstDeductCountButton(page);
    if (!btn) {
      test.skip(true, '이번달 차감 건수 ≥1 치료사 행 없음 — drill-down 대상 없음');
      return;
    }

    // AC1: 클릭 가능한 링크형 버튼
    const count = Number((await btn.textContent())?.trim() ?? '0');
    expect(count).toBeGreaterThan(0);

    await btn.click();

    // AC2: 리스트 팝업 표시
    const dialogTitle = page.getByTestId('deduct-dialog-title');
    await expect(dialogTitle).toBeVisible({ timeout: 3000 });
    await expect(dialogTitle).toContainText('차감 고객 리스트');

    // AC2/AC6: 리스트 건수 == 클릭한 차감 건수 (카운트-리스트 정합)
    const rows = page.locator('[data-testid^="deduct-dialog-row-"]');
    await expect(rows).toHaveCount(count);
  });

  test('AC3 — 리스트 행에 고객명·차트번호·차감 날짜·차감 항목 표시', async ({ page }) => {
    await gotoStaffTab(page);

    const btn = await firstDeductCountButton(page);
    if (!btn) {
      test.skip(true, '이번달 차감 건수 ≥1 치료사 행 없음 — 리스트 표시 대상 없음');
      return;
    }
    await btn.click();
    await expect(page.getByTestId('deduct-dialog-list')).toBeVisible({ timeout: 3000 });

    // 헤더 4항목 존재
    for (const h of ['고객성함', '차트번호', '차감 날짜', '차감 항목']) {
      await expect(page.getByRole('columnheader', { name: h })).toBeVisible();
    }
    // 첫 행에 4개 셀(td) 존재
    const firstRow = page.locator('[data-testid^="deduct-dialog-row-"]').first();
    await expect(firstRow.locator('td')).toHaveCount(4);
  });

  test('AC4 — 리스트 고객 클릭 → 2번차트(고객차트) 오픈', async ({ page }) => {
    await gotoStaffTab(page);

    const btn = await firstDeductCountButton(page);
    if (!btn) {
      test.skip(true, '이번달 차감 건수 ≥1 치료사 행 없음 — 2번차트 이동 대상 없음');
      return;
    }
    await btn.click();
    await expect(page.getByTestId('deduct-dialog-list')).toBeVisible({ timeout: 3000 });

    // 리스트 첫 고객(클릭 가능한 행) 클릭
    await page.locator('[data-testid^="deduct-dialog-row-"]').first().click();

    // 팝업 닫히고 기존 2번차트 라우팅으로 진입(자동화 → in-page 서랍 폴백)
    await expect(page.getByTestId('deduct-dialog-title')).not.toBeVisible({ timeout: 3000 });
    await expect(page.getByTestId('customer-chart-sheet')).toBeVisible({ timeout: 5000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 엣지 케이스 (차감 건수 0 비활성 / 리스트 재갱신)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 2 — 엣지 케이스', () => {
  test('AC5 — 차감 건수 0 셀은 클릭 버튼이 아니다(비활성 텍스트)', async ({ page }) => {
    await gotoStaffTab(page);

    // 클릭 가능한 차감 건수 버튼의 텍스트는 모두 1 이상이어야 한다(0은 span).
    const btns = page.locator('button[data-testid^="sales-staff-deduct-count-"]');
    const n = await btns.count();
    for (let i = 0; i < n; i++) {
      const t = Number((await btns.nth(i).textContent())?.trim() ?? '0');
      expect(t).toBeGreaterThan(0);
    }
  });

  test('리스트 닫기 후 다른 치료사 차감 건수 클릭 → 새 리스트로 갱신', async ({ page }) => {
    await gotoStaffTab(page);

    const btns = page.locator('button[data-testid^="sales-staff-deduct-count-"]');
    const n = await btns.count();
    if (n < 2) {
      test.skip(true, '차감 치료사 행이 2개 미만 — 재갱신 시나리오 대상 없음');
      return;
    }

    await btns.nth(0).click();
    await expect(page.getByTestId('deduct-dialog-title')).toBeVisible({ timeout: 3000 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('deduct-dialog-title')).not.toBeVisible({ timeout: 2000 });

    const count2 = Number((await btns.nth(1).textContent())?.trim() ?? '0');
    await btns.nth(1).click();
    await expect(page.getByTestId('deduct-dialog-title')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-testid^="deduct-dialog-row-"]')).toHaveCount(count2);
  });
});
