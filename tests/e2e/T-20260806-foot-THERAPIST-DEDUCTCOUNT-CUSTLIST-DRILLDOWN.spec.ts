/**
 * T-20260806-foot-THERAPIST-DEDUCTCOUNT-CUSTLIST-DRILLDOWN
 * 매출집계 > 담당치료사별 '차감 건수' 클릭 → 차감 고객 리스트 팝업 → 고객 클릭 → 2번차트 이동
 *
 * 선례 재사용: T-20260725-foot-THERAPIST-DESIGNATED-CUSTLIST-DRILLDOWN (deployed 8f3447e76f74).
 *   '지정 수' drill-down 과 동일 구조(셀 클릭→Dialog→useChart.openChart)를 '차감 건수' 컬럼에 재적용.
 *
 * 티켓 §현장 클릭 시나리오 2종 변환:
 *   시나리오 1(정상 동선): 차감건수(≥1) 클릭 → 리스트 팝업(건수 == 차감건수) →
 *                          행 항목(고객명·차트번호·차감 날짜·차감 항목) 확인 → 고객 클릭 → 2번차트 오픈
 *   시나리오 2(엣지):      차감건수 0(화장품-only 치료사) = 비활성(버튼 아님) /
 *                          리스트 닫은 뒤 다른 치료사 재클릭 시 새 리스트로 갱신
 *
 * AC 매핑:
 *   AC1 — '차감 건수' 셀(≥1)이 클릭 가능한 링크형 버튼으로 표시
 *   AC2 — 클릭 시 차감 고객 리스트 팝업, 리스트 건수 == 표에 보이던 '차감건수' (단일소스 파생 정합)
 *   AC3 — 리스트 표시항목: 고객명 · 차트번호 · 차감 날짜 · 차감 항목(시술명)
 *   AC4 — 리스트 고객(행) 클릭 → 기존 2번차트 라우팅(useChart.openChart) 재사용
 *          (Playwright=navigator.webdriver → window.open 팝업 대신 in-page CustomerChartSheet 서랍 폴백)
 *   AC5 — 차감건수 0(화장품-only) 치료사는 비활성(버튼 없음) — 에러/빈 화면 없음
 *   AC6 — 매출집계 '차감건수' 산식 불변 (READ-ONLY, DB 변경 없음 — 조회 + 기존 라우팅 재사용)
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const SALES_URL = `${BASE_URL}/admin/sales`;

// 인증 세션은 desktop-chrome 프로젝트의 storageState(AUTH_FILE=.auth/user.json,
// auth.setup 이 로그인 후 기록)를 상속한다 — spec 레벨 경로 하드코딩 override 금지
// (선례 T-20260725 의 'playwright/.auth/user.json' 하드코딩은 AUTH_FILE 와 불일치했던 취약점).

/** 담당치료사별 탭(차감기준) 진입 + 이번달 프리셋(차감 행 노출 가능성 최대화). */
async function gotoStaffTab(page: import('@playwright/test').Page) {
  await page.goto(SALES_URL);
  await page.waitForLoadState('networkidle');
  const staffTab = page.getByRole('tab', { name: /담당치료사별/ });
  await staffTab.waitFor({ state: 'visible', timeout: 15000 });
  await staffTab.click();
  await page.waitForLoadState('networkidle');
  // 이번달 프리셋 — 차감 데이터 폭을 넓혀 치료사 행 노출 가능성 ↑ (탭 진입 후 적용)
  await page.getByTestId('sales-preset-month').click().catch(() => {});
  await page.waitForLoadState('networkidle');
  // 차감기준 뷰 강제(기본값이지만 명시) — 차감 건수 셀은 차감기준 뷰에만 존재
  await page.getByTestId('sales-staff-basis-deduction').click().catch(() => {});
  await page.waitForLoadState('networkidle');
}

/**
 * 클릭 가능한 '차감 건수' 버튼(값 ≥ 1) 중 첫 번째를 반환. 없으면 null.
 * 셀 testid = sales-staff-deduct-count-{staffId}. 값>0 → <button>, 값=0 → <span>(비활성).
 * 합계행 testid(sales-staff-deduct-total-count)는 prefix 불일치로 자연 제외됨.
 */
async function firstDeductCountButton(page: import('@playwright/test').Page) {
  const btn = page.locator('button[data-testid^="sales-staff-deduct-count-"]').first();
  const visible = await btn.isVisible().catch(() => false);
  return visible ? btn : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 정상 동선 (차감건수 → 리스트 → 2번차트)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 1 — 차감건수 drill-down → 2번차트', () => {
  test('담당치료사별(차감기준) 탭 진입 정상 렌더(에러 없음)', async ({ page }) => {
    await gotoStaffTab(page);
    // 차감기준 뷰 = 표(sales-staff-deduct-tab) 또는 빈 안내(sales-staff-deduct-empty) 중 하나가
    // 에러 없이 렌더되면 성공. (Radix data-state 속성 대신 실제 뷰 렌더로 판정 — 부하 하 안정)
    const anyView = page
      .locator(
        '[data-testid="sales-staff-deduct-tab"], [data-testid="sales-staff-deduct-empty"]',
      )
      .first();
    await expect(anyView).toBeVisible({ timeout: 15000 });
  });

  test('AC1·AC2 — 차감건수(≥1) 클릭 → 리스트 팝업, 건수 == 차감건수', async ({ page }) => {
    await gotoStaffTab(page);

    const btn = await firstDeductCountButton(page);
    if (!btn) {
      test.skip(true, '이번달 차감건수 ≥1 치료사 행 없음 — drill-down 대상 없음');
      return;
    }

    // AC1: 클릭 가능한 링크형 버튼
    const count = Number((await btn.textContent())?.trim() ?? '0');
    expect(count).toBeGreaterThan(0);

    await btn.click();

    // AC2: 리스트 팝업 표시
    const dialogTitle = page.getByTestId('deduct-count-dialog-title');
    await expect(dialogTitle).toBeVisible({ timeout: 3000 });
    await expect(dialogTitle).toContainText('차감 고객 리스트');

    // AC2: 리스트 건수 == 클릭한 차감건수 (단일소스 length 파생 정합)
    const rows = page.locator('[data-testid^="deduct-count-dialog-row-"]');
    await expect(rows).toHaveCount(count);
  });

  test('AC3 — 리스트 표시항목(고객명·차트번호·차감 날짜·차감 항목) 존재', async ({ page }) => {
    await gotoStaffTab(page);

    const btn = await firstDeductCountButton(page);
    if (!btn) {
      test.skip(true, '이번달 차감건수 ≥1 치료사 행 없음 — 표시항목 검증 대상 없음');
      return;
    }
    await btn.click();
    await expect(page.getByTestId('deduct-count-dialog-list')).toBeVisible({ timeout: 3000 });

    // AC3: 헤더 4종(고객명·차트번호·차감 날짜·차감 항목)
    for (const h of ['고객명', '차트번호', '차감 날짜', '차감 항목']) {
      await expect(page.getByRole('columnheader', { name: h })).toBeVisible();
    }
    // 첫 행에 4개 셀(td) 존재 확인
    const firstRow = page.locator('[data-testid^="deduct-count-dialog-row-"]').first();
    await expect(firstRow.locator('td')).toHaveCount(4);
  });

  test('AC4 — 리스트 고객 클릭 → 2번차트(고객차트) 오픈', async ({ page }) => {
    await gotoStaffTab(page);

    const btn = await firstDeductCountButton(page);
    if (!btn) {
      test.skip(true, '이번달 차감건수 ≥1 치료사 행 없음 — 2번차트 이동 대상 없음');
      return;
    }
    await btn.click();
    await expect(page.getByTestId('deduct-count-dialog-list')).toBeVisible({ timeout: 3000 });

    // 리스트 첫 고객(행) 클릭
    await page.locator('[data-testid^="deduct-count-dialog-row-"]').first().click();

    // 팝업 닫히고 기존 2번차트 라우팅으로 진입
    // (Playwright=자동화 → window.open 팝업 폴백 = in-page CustomerChartSheet 서랍)
    await expect(page.getByTestId('deduct-count-dialog-title')).not.toBeVisible({ timeout: 3000 });
    await expect(page.getByTestId('customer-chart-sheet')).toBeVisible({ timeout: 5000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 엣지 케이스 (차감건수 0 비활성 / 리스트 재갱신)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 2 — 엣지 케이스', () => {
  test('AC5 — 차감건수 0 셀은 클릭 버튼이 아니다(비활성 텍스트)', async ({ page }) => {
    await gotoStaffTab(page);

    // 값이 0인 차감건수 셀(화장품-only 치료사)은 button 이 아니라 span(text-muted).
    // 즉, button 으로 렌더된 차감건수는 모두 값이 1 이상이어야 한다.
    const btns = page.locator('button[data-testid^="sales-staff-deduct-count-"]');
    const n = await btns.count();
    for (let i = 0; i < n; i++) {
      const t = Number((await btns.nth(i).textContent())?.trim() ?? '0');
      expect(t).toBeGreaterThan(0); // 0짜리는 버튼으로 렌더되지 않음(비활성)
    }
    // 0으로 렌더된 span 이 있다면 클릭해도 팝업이 뜨지 않아야 함(에러/빈 화면 없음)
    const zeroSpan = page.locator('span[data-testid^="sales-staff-deduct-count-"]').first();
    if (await zeroSpan.isVisible().catch(() => false)) {
      await expect(zeroSpan).toHaveText('0');
      await zeroSpan.click().catch(() => {});
      await expect(page.getByTestId('deduct-count-dialog-title')).not.toBeVisible();
    }
  });

  test('리스트 닫기 후 다른 치료사 차감건수 클릭 → 새 리스트로 갱신', async ({ page }) => {
    await gotoStaffTab(page);

    const btns = page.locator('button[data-testid^="sales-staff-deduct-count-"]');
    const n = await btns.count();
    if (n < 2) {
      test.skip(true, '차감 치료사 행이 2개 미만 — 재갱신 시나리오 대상 없음');
      return;
    }

    // 첫 치료사 리스트 열고 닫기
    await btns.nth(0).click();
    await expect(page.getByTestId('deduct-count-dialog-title')).toBeVisible({ timeout: 3000 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('deduct-count-dialog-title')).not.toBeVisible({ timeout: 2000 });

    // 두 번째 치료사 리스트 열기 → 건수 정합 유지
    const count2 = Number((await btns.nth(1).textContent())?.trim() ?? '0');
    await btns.nth(1).click();
    await expect(page.getByTestId('deduct-count-dialog-title')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-testid^="deduct-count-dialog-row-"]')).toHaveCount(count2);
  });
});
