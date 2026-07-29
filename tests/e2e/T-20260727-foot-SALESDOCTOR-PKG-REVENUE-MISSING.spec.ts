/**
 * T-20260727-foot-SALESDOCTOR-PKG-REVENUE-MISSING (A안 ADDITIVE)
 * 매출집계 탭4(담당실장별) — 패키지(선수금) 매출 별도 컬럼 신규 추가 E2E
 *
 * 현장 확정 스펙(김주연 총괄 2026-07-27 19:05, A안 + 판매시점):
 *   - tax_type='선수금'(패키지 선결제)이 기존 3축(급여/비급여/공단)에서 제외되어
 *     담당실장별 화면에 패키지 매출이 0원/미표시였던 문제.
 *   - A안 ADDITIVE: 최우측에 "패키지 (선수금)" 컬럼 신규 추가. 기존 급여/비급여 불변(회귀 0 = 게이트).
 *   - 인식시점 = 판매(결제)시점(accounting_date). 회차 차감시점 아님(차감은 payments row 미생성).
 *
 * 현장 클릭 시나리오(티켓 본문 확정판) → E2E 변환:
 *   시나리오 1: 패키지 컬럼 표시 — 급여/비급여 오른쪽(최우측)에 "패키지" 컬럼 신규 렌더.
 *   시나리오 2: 회귀(배포 게이트) — 기존 급여/비급여/공단 컬럼 구조·셀·포맷 불변.
 *
 * 빈 데이터(staging DB)에서는 empty state / 컬럼 헤더·구조 검증으로 대체.
 * ※ 숫자 절대값 회귀는 코드레벨로 보장(기존 급여/비급여/공단 버킷 로직 무변경, 선수금 버킷만
 *    별도 packageRevenue로 분기) — E2E는 컬럼 구조·데이터소스 testid 불변으로 구조적 회귀를 검증.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const SALES_URL = '/admin/sales';
const TAB_NAME = '담당실장별';

async function gotoDoctorTab(page: import('@playwright/test').Page) {
  await page.goto(SALES_URL);
  await expect(page.getByRole('heading', { name: '매출집계' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('tab', { name: TAB_NAME }).click();
  await expect(page.locator('[data-testid="sales-doctor-loading"]')).toHaveCount(0, {
    timeout: 25_000,
  });
  await expect(
    page.locator('[data-testid="sales-doctor-tab"], [data-testid="sales-doctor-empty"]'),
  ).toBeVisible({ timeout: 10_000 });
}

async function hasTable(page: import('@playwright/test').Page) {
  return page
    .locator('[data-testid="sales-doctor-tab"]')
    .isVisible({ timeout: 5_000 })
    .catch(() => false);
}

test.describe('T-20260727-foot-SALESDOCTOR-PKG-REVENUE-MISSING 패키지(선수금) 컬럼', () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded — auth 실패');
  });

  // ── 시나리오 1: 패키지 컬럼 헤더가 최우측에 신규 렌더 ─────────────────────────
  test('시나리오1: "패키지 (선수금)" 컬럼 헤더가 최우측에 노출', async ({ page }) => {
    await gotoDoctorTab(page);

    if (!(await hasTable(page))) {
      console.log('[PKG-REVENUE] empty state — 헤더 검증 skip');
      await expect(page.locator('[data-testid="sales-doctor-empty"]')).toBeVisible();
      return;
    }

    const tableEl = page.locator('[data-testid="sales-doctor-tab"]');
    const headers = tableEl.getByRole('columnheader');
    // 신규 패키지 컬럼 노출
    await expect(tableEl.getByRole('columnheader', { name: '패키지 (선수금)' })).toBeVisible();
    // 최우측 배치 검증 — 마지막 컬럼헤더가 패키지
    await expect(headers.last()).toHaveText('패키지 (선수금)');
    console.log('[PKG-REVENUE] 시나리오1 패키지 컬럼 최우측 렌더 OK');
  });

  // ── 시나리오 1: 패키지 셀/합계가 "원" 금액 포맷으로 렌더 ──────────────────────
  test('시나리오1: 패키지 합계/행 셀이 "원" 금액 포맷으로 렌더', async ({ page }) => {
    await gotoDoctorTab(page);

    if (!(await hasTable(page))) {
      console.log('[PKG-REVENUE] empty state — 패키지 셀 검증 skip');
      return;
    }

    // 합계 행 패키지 셀 존재 + "원" 포맷
    const totalPkg = page.locator('[data-testid="sales-doctor-total-package"]');
    await expect(totalPkg).toBeVisible();
    await expect(totalPkg).toContainText('원');

    // 행별 패키지 셀도 "원" 포맷
    const rowPkg = page.locator('[data-testid^="sales-doctor-package-"]').first();
    if (await rowPkg.isVisible().catch(() => false)) {
      await expect(rowPkg).toContainText('원');
    }
    console.log('[PKG-REVENUE] 시나리오1 패키지 금액 포맷 렌더 OK');
  });

  // ── 시나리오 2: 회귀(배포 게이트) — 기존 급여/비급여/공단 컬럼 구조 불변 ──────
  test('시나리오2(게이트): 기존 급여/비급여/공단 컬럼·셀 구조 불변 + 패키지만 ADDITIVE', async ({ page }) => {
    await gotoDoctorTab(page);

    if (!(await hasTable(page))) {
      console.log('[PKG-REVENUE] empty state — 회귀 구조 검증 skip');
      return;
    }

    const tableEl = page.locator('[data-testid="sales-doctor-tab"]');
    // 기존 5개 컬럼 헤더 그대로 유지 (라벨·존재 불변)
    await expect(tableEl.getByRole('columnheader', { name: '담당실장' })).toBeVisible();
    await expect(tableEl.getByRole('columnheader', { name: '오더 건수' })).toBeVisible();
    await expect(tableEl.getByRole('columnheader', { name: '비급여 순매출' })).toBeVisible();
    await expect(tableEl.getByRole('columnheader', { name: '급여 본부금' })).toBeVisible();
    await expect(tableEl.getByRole('columnheader', { name: '공단부담액 (명세)' })).toBeVisible();
    // 패키지 컬럼이 추가되어 총 6개 (ADDITIVE — 기존 5개 + 1)
    await expect(tableEl.getByRole('columnheader')).toHaveCount(6);

    // 기존 데이터소스 testid 불변(급여/비급여/공단 합계 셀 그대로 존재)
    await expect(page.locator('[data-testid="sales-doctor-total-nonins"]')).toBeVisible();
    await expect(page.locator('[data-testid="sales-doctor-total-covered"]')).toBeVisible();
    console.log('[PKG-REVENUE] 시나리오2 기존 컬럼 구조 불변 + 6컬럼 ADDITIVE OK');
  });

  // ── 엣지: 데이터 없어도 에러 없이 렌더 ───────────────────────────────────────
  test('엣지: 선수금 없는 상태에서도 에러 없이 렌더(table or empty)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await gotoDoctorTab(page);
    await page.waitForTimeout(1_500);

    const table = await hasTable(page);
    const empty = await page
      .locator('[data-testid="sales-doctor-empty"]')
      .isVisible()
      .catch(() => false);

    expect(table || empty).toBe(true);
    expect(errors, `pageerror 발생: ${errors.join(' | ')}`).toHaveLength(0);
    console.log(`[PKG-REVENUE] 엣지 무에러 렌더 OK — table:${table} empty:${empty}`);
  });
});
