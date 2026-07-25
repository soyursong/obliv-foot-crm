/**
 * T-20260725-foot-THERAPIST-DESIGNATED-CUSTLIST-DRILLDOWN
 * 매출집계 > 담당치료사별 '지정 수' 클릭 → 지정 고객 명단 팝업 → 고객 클릭 → 2번차트 이동
 *
 * 티켓 §현장 클릭 시나리오 2종 변환:
 *   시나리오 1(정상 동선): 지정 수(≥1) 클릭 → 명단 팝업(인원 == 지정 수) → 고객 클릭 → 2번차트 오픈
 *   시나리오 2(엣지):      지정 수 0 = 비활성(클릭 대상 아님) / 명단 닫기 후 다른 치료사 재클릭 시 갱신
 *
 * AC 매핑:
 *   AC1 — '지정 수' 셀이 클릭 가능(링크형 버튼)으로 표시
 *   AC2 — 클릭 시 지정 고객 명단 팝업, 인원 수 = 표에 보이던 '지정 수' (카운트-명단 정합)
 *   AC3 — 명단 고객 클릭 → 기존 2번차트 라우팅(useChart.openChart) 재사용
 *          (Playwright=navigator.webdriver → window.open 팝업 대신 in-page CustomerChartSheet 서랍 폴백)
 *   AC4 — 지정 수 0 치료사는 비활성(버튼 없음) — 에러/빈 화면 없음
 *   AC5 — 김규리 지정 1명(김병완, F-4741) = 명단 클릭 결과와 일치(자기검증). prod 데이터 의존이라
 *          이 spec에서는 '지정 수 == 명단 인원' 정합으로 일반 검증(누구인지는 티켓 회신으로 확정).
 *
 * READ-ONLY — DB 변경 없음(집계 조회 + 기존 라우팅 재사용).
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const SALES_URL = `${BASE_URL}/admin/sales`;

test.use({ storageState: 'playwright/.auth/user.json' });

/** 담당치료사별 탭 진입 + 이번달 프리셋(지정 치료사 행 노출 가능성 최대화). */
async function gotoStaffTab(page: import('@playwright/test').Page) {
  await page.goto(SALES_URL);
  await page.waitForLoadState('networkidle');
  const staffTab = page.getByRole('tab', { name: /담당치료사별/ });
  await staffTab.waitFor({ state: 'visible', timeout: 15000 });
  await staffTab.click();
  await page.waitForLoadState('networkidle');
  // 이번달 프리셋 — 차감/수납 데이터 폭을 넓혀 치료사 행 노출 가능성 ↑ (탭 진입 후 적용)
  await page.getByTestId('sales-preset-month').click().catch(() => {});
  await page.waitForLoadState('networkidle');
}

/** 현재 화면에서 클릭 가능한 '지정 수' 버튼(값 ≥ 1) 중 첫 번째를 반환. 없으면 null. */
async function firstDesignatedButton(page: import('@playwright/test').Page) {
  // 차감기준: sales-staff-deduct-designated-*, 수납기준: sales-staff-designated-therapist-*
  const btn = page
    .locator(
      '[data-testid^="sales-staff-deduct-designated-"], [data-testid^="sales-staff-designated-therapist-"]',
    )
    .first();
  const visible = await btn.isVisible().catch(() => false);
  return visible ? btn : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 정상 동선 (지정 수 → 명단 → 2번차트)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 1 — 지정 수 drill-down → 2번차트', () => {
  test('담당치료사별 탭 진입 정상 렌더(에러 없음)', async ({ page }) => {
    await gotoStaffTab(page);
    await expect(page.getByRole('tab', { name: /담당치료사별/ })).toHaveAttribute(
      'data-state',
      'active',
    );
    // 표(차감/수납) 또는 empty 중 하나 — 에러 없음
    const anyView = page
      .locator(
        '[data-testid="sales-staff-deduct-tab"], [data-testid="sales-staff-tab"], [data-testid="sales-staff-deduct-empty"], [data-testid="sales-staff-empty"]',
      )
      .first();
    await expect(anyView).toBeVisible();
  });

  test('AC1·AC2 — 지정 수(≥1) 클릭 → 명단 팝업, 인원 수 == 지정 수', async ({ page }) => {
    await gotoStaffTab(page);

    const btn = await firstDesignatedButton(page);
    if (!btn) {
      test.skip(true, '이번달 지정 수 ≥1 치료사 행 없음 — drill-down 대상 없음');
      return;
    }

    // AC1: 클릭 가능한 링크형 버튼 (button 요소)
    const count = Number((await btn.textContent())?.trim() ?? '0');
    expect(count).toBeGreaterThan(0);

    await btn.click();

    // AC2: 명단 팝업 표시
    const dialogTitle = page.getByTestId('designated-dialog-title');
    await expect(dialogTitle).toBeVisible({ timeout: 3000 });
    await expect(dialogTitle).toContainText('지정 고객');

    // AC2: 명단 인원 수 == 클릭한 지정 수 (카운트-명단 정합)
    const items = page.locator('[data-testid^="designated-dialog-customer-"]');
    await expect(items).toHaveCount(count);
  });

  test('AC3 — 명단 고객 클릭 → 2번차트(고객차트) 오픈', async ({ page }) => {
    await gotoStaffTab(page);

    const btn = await firstDesignatedButton(page);
    if (!btn) {
      test.skip(true, '이번달 지정 수 ≥1 치료사 행 없음 — 2번차트 이동 대상 없음');
      return;
    }
    await btn.click();
    await expect(page.getByTestId('designated-dialog-list')).toBeVisible({ timeout: 3000 });

    // 명단 첫 고객 클릭
    await page.locator('[data-testid^="designated-dialog-customer-"]').first().click();

    // 팝업은 닫히고, 기존 2번차트 라우팅으로 진입
    // (Playwright=자동화 → window.open 팝업 폴백 = in-page CustomerChartSheet 서랍)
    await expect(page.getByTestId('designated-dialog-title')).not.toBeVisible({ timeout: 3000 });
    await expect(page.getByTestId('customer-chart-sheet')).toBeVisible({ timeout: 5000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 엣지 케이스 (지정 수 0 비활성 / 명단 재갱신)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 2 — 엣지 케이스', () => {
  test('AC4 — 지정 수 0 셀은 클릭 버튼이 아니다(비활성 텍스트)', async ({ page }) => {
    await gotoStaffTab(page);

    // 값이 0인 지정 수 셀은 button(data-testid designated-*)이 아니라 일반 span.
    // 즉, 지정 수 버튼의 텍스트는 모두 1 이상이어야 한다.
    const btns = page.locator(
      '[data-testid^="sales-staff-deduct-designated-"], [data-testid^="sales-staff-designated-therapist-"]',
    );
    const n = await btns.count();
    for (let i = 0; i < n; i++) {
      const t = Number((await btns.nth(i).textContent())?.trim() ?? '0');
      expect(t).toBeGreaterThan(0); // 0짜리는 버튼으로 렌더되지 않음(비활성)
    }
  });

  test('명단 닫기 후 다른 치료사 지정 수 클릭 → 새 명단으로 갱신', async ({ page }) => {
    await gotoStaffTab(page);

    const btns = page.locator(
      '[data-testid^="sales-staff-deduct-designated-"], [data-testid^="sales-staff-designated-therapist-"]',
    );
    const n = await btns.count();
    if (n < 2) {
      test.skip(true, '지정 치료사 행이 2개 미만 — 재갱신 시나리오 대상 없음');
      return;
    }

    // 첫 치료사 명단 열고 닫기
    await btns.nth(0).click();
    await expect(page.getByTestId('designated-dialog-title')).toBeVisible({ timeout: 3000 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('designated-dialog-title')).not.toBeVisible({ timeout: 2000 });

    // 두 번째 치료사 명단 열기 → 인원 정합 유지
    const count2 = Number((await btns.nth(1).textContent())?.trim() ?? '0');
    await btns.nth(1).click();
    await expect(page.getByTestId('designated-dialog-title')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-testid^="designated-dialog-customer-"]')).toHaveCount(count2);
  });
});
