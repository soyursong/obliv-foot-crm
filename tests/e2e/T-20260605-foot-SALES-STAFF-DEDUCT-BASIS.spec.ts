/**
 * T-20260605-foot-SALES-STAFF-DEDUCT-BASIS
 * 매출집계 탭5 — 담당직원별 귀속 기준 전환(수납 → 패키지 차감) E2E
 *
 * 시나리오:
 *   1. [매출집계] → [담당치료사별] 탭 → 귀속 기준 토글 렌더 (기본 차감기준)
 *   2. 차감기준 view: 치료사·차감건수·차감매출 컬럼 + 합계행 (또는 empty)
 *   3. 토글 → 수납기준 view 전환: 기존 직원별 테이블(역할/순실적) 유지 비파괴
 *   4. 토글 → 차감기준 복귀
 *   5. 기간 프리셋(이번달) 후에도 토글/탭 유지
 *   6. 검색 필터: 없는 이름 → 0행/empty
 *   7. [핵심 회귀] 차감기준 매출이 0원이 아님 — unit_price 스냅샷 backfill 검증 + 스크린샷
 *
 * 견고성(2026-06-05 FIX-REQUEST 하드닝):
 *   - 헤더 '매출집계'는 사이드바 nav + 페이지 h1 2곳 → getByRole('heading') 으로 한정(strict mode 회피).
 *   - deduct 쿼리(useQuery) 비동기 settle 까지 명시 대기(loading hidden → tab|empty visible).
 *   - prod 실데이터(차감 used 세션 존재) / staging 빈데이터 양쪽 모두 통과.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const SALES_URL = '/admin/sales';
const SHOT_DIR = '_handoff/qa_screenshots/T-20260605-foot-SALES-STAFF-DEDUCT-BASIS';

/** 매출집계 → 담당치료사별 탭 진입 (탭 active 까지 대기). */
async function openStaffTab(page: Page) {
  await page.goto(SALES_URL);
  // 사이드바 nav 와 페이지 h1 둘 다 '매출집계' → heading 으로 한정.
  await expect(page.getByRole('heading', { name: '매출집계' })).toBeVisible({ timeout: 10_000 });
  const tab = page.getByRole('tab', { name: '담당치료사별' });
  await tab.click();
  // base-ui Tabs: active 탭은 aria-selected="true" (Radix 의 data-state 아님).
  await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });
  // 귀속 기준 토글이 떠야 SalesStaffTab 마운트 완료.
  await expect(page.locator('[data-testid="sales-staff-basis-toggle"]')).toBeVisible({ timeout: 10_000 });
}

/** 차감기준 view 비동기 settle 대기 → deduct-tab(데이터) | deduct-empty(빈) 중 하나가 보일 때까지. */
async function settleDeduction(page: Page): Promise<'data' | 'empty'> {
  await page
    .locator('[data-testid="sales-staff-loading"]')
    .waitFor({ state: 'hidden', timeout: 15_000 })
    .catch(() => {});
  await page
    .locator('[data-testid="sales-staff-deduct-tab"], [data-testid="sales-staff-deduct-empty"]')
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  const hasData = await page.locator('[data-testid="sales-staff-deduct-tab"]').isVisible().catch(() => false);
  return hasData ? 'data' : 'empty';
}

/** 수납기준 view settle 대기. */
async function settlePayment(page: Page): Promise<'data' | 'empty'> {
  await page
    .locator('[data-testid="sales-staff-loading"]')
    .waitFor({ state: 'hidden', timeout: 15_000 })
    .catch(() => {});
  await page
    .locator('[data-testid="sales-staff-tab"], [data-testid="sales-staff-empty"]')
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  const hasData = await page.locator('[data-testid="sales-staff-tab"]').isVisible().catch(() => false);
  return hasData ? 'data' : 'empty';
}

function parseWon(text: string): number {
  return Number((text.match(/-?[\d,]+/)?.[0] ?? '0').replace(/,/g, ''));
}

test.describe('T-20260605-foot-SALES-STAFF-DEDUCT-BASIS 담당직원별 차감기준 전환', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded — auth 실패');
  });

  // ── 1. 귀속 기준 토글 렌더 (기본 차감기준) ──────────────────────────────
  test('담당직원별 탭 → 귀속 기준 토글 렌더 + 기본값 차감기준', async ({ page }) => {
    await openStaffTab(page);
    await expect(page.locator('[data-testid="sales-staff-basis-deduction"]')).toBeVisible();
    await expect(page.locator('[data-testid="sales-staff-basis-payment"]')).toBeVisible();

    const state = await settleDeduction(page);
    console.log(`[DEDUCT-BASIS] 토글 렌더 OK — 기본 차감기준 view=${state}`);
  });

  // ── 2. 차감기준 view 컬럼/합계 ──────────────────────────────────────────
  test('차감기준 view: 치료사·차감건수·차감매출 컬럼 + 합계행', async ({ page }) => {
    await openStaffTab(page);
    const state = await settleDeduction(page);

    if (state === 'empty') {
      await expect(page.locator('[data-testid="sales-staff-deduct-empty"]')).toBeVisible();
      console.log('[DEDUCT-BASIS] 차감 데이터 없음 — empty state 정상');
      return;
    }

    const tbl = page.locator('[data-testid="sales-staff-deduct-tab"]');
    // 컬럼 헤더는 columnheader role 로 한정 (footnote 의 '치료사' 등 본문 텍스트와 충돌 회피).
    await expect(tbl.getByRole('columnheader', { name: '치료사' })).toBeVisible();
    await expect(tbl.getByRole('columnheader', { name: '차감 건수' })).toBeVisible();
    await expect(tbl.getByRole('columnheader', { name: '차감 매출' })).toBeVisible();
    await expect(page.locator('[data-testid="sales-staff-deduct-total-count"]')).toBeVisible();
    await expect(page.locator('[data-testid="sales-staff-deduct-total-revenue"]')).toBeVisible();
    console.log('[DEDUCT-BASIS] 차감기준 컬럼/합계 OK');
  });

  // ── 3. 수납기준 view 전환 — 기존 비파괴 ─────────────────────────────────
  test('수납기준 토글 → 기존 직원별 테이블(역할/순실적) 유지', async ({ page }) => {
    await openStaffTab(page);
    await settleDeduction(page);

    await page.locator('[data-testid="sales-staff-basis-payment"]').click();
    const state = await settlePayment(page);

    if (state === 'data') {
      const tbl = page.locator('[data-testid="sales-staff-tab"]');
      await expect(tbl.getByText('역할')).toBeVisible();
      await expect(tbl.getByText('순 실적')).toBeVisible();
      await expect(page.locator('[data-testid="sales-staff-total-net"]')).toBeVisible();
    }
    console.log(`[DEDUCT-BASIS] 수납기준 비파괴 OK — view=${state}`);
  });

  // ── 4. 차감기준 복귀 ────────────────────────────────────────────────────
  test('수납 → 차감 토글 복귀 정상', async ({ page }) => {
    await openStaffTab(page);
    await settleDeduction(page);

    await page.locator('[data-testid="sales-staff-basis-payment"]').click();
    await settlePayment(page);
    await page.locator('[data-testid="sales-staff-basis-deduction"]').click();
    const state = await settleDeduction(page);
    console.log(`[DEDUCT-BASIS] 차감기준 복귀 OK — view=${state}`);
  });

  // ── 5. 기간 프리셋 후에도 탭/토글 유지 ──────────────────────────────────
  test('프리셋(이번달) 후 탭/토글 유지 + 렌더', async ({ page }) => {
    await openStaffTab(page);
    await settleDeduction(page);

    await page.locator('[data-testid="sales-preset-month"]').click();
    await settleDeduction(page);

    const staffTab = page.getByRole('tab', { name: '담당치료사별' });
    await expect(staffTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid="sales-staff-basis-toggle"]')).toBeVisible();
    console.log('[DEDUCT-BASIS] 프리셋 후 토글 유지 OK');
  });

  // ── 6. 검색 필터 — 없는 이름 ────────────────────────────────────────────
  test('검색바 없는 이름 → 차감기준 0행/empty', async ({ page }) => {
    await openStaffTab(page);
    await settleDeduction(page);

    const searchInput = page.locator('[data-testid="sales-search"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('존재하지않는치료사XXXXXXX');
    await page.waitForTimeout(600);

    const hasTable = await page.locator('[data-testid="sales-staff-deduct-tab"]').isVisible().catch(() => false);
    if (hasTable) {
      const rows = await page.locator('[data-testid^="sales-staff-deduct-row-"]').count();
      expect(rows).toBe(0);
    } else {
      await expect(page.locator('[data-testid="sales-staff-deduct-empty"]')).toBeVisible();
    }
    await searchInput.fill('');
    console.log('[DEDUCT-BASIS] 검색 필터 OK');
  });

  // ── 7. [핵심 회귀] 차감기준 매출 0원 아님 — backfill 스냅샷 검증 + 스크린샷 ──
  //   QA FIX-REQUEST: backfill 적용 후 담당치료사별 탭 차감기준 매출이 0원이 아님을 화면으로 증명.
  //   '이번달' 프리셋으로 차감 used 세션이 있는 기간을 잡아 합계 매출 > 0 단언.
  test('차감기준 매출이 0원 아님 (backfill 스냅샷 회귀) + 스크린샷', async ({ page }) => {
    await openStaffTab(page);

    // 이번달 프리셋: 당월 차감(used) 세션 집계.
    await page.locator('[data-testid="sales-preset-month"]').click();
    const state = await settleDeduction(page);

    if (state === 'empty') {
      // 당월 차감 내역이 전혀 없는 환경(예: 신규 staging)에서는 회귀 단언 불가 → 정보성 skip.
      await page.screenshot({ path: `${SHOT_DIR}/staff_deduct_empty.png`, fullPage: true });
      test.skip(true, '당월 차감 used 세션 없음 — 0원 회귀 단언 대상 데이터 부재(empty)');
      return;
    }

    const totalRevenue = page.locator('[data-testid="sales-staff-deduct-total-revenue"]');
    await expect(totalRevenue).toBeVisible();
    const revText = (await totalRevenue.textContent())?.trim() ?? '';
    const revValue = parseWon(revText);

    // 스크린샷 — 합계 매출 행이 보이도록 캡처.
    await totalRevenue.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOT_DIR}/staff_deduct_revenue_nonzero.png`, fullPage: true });

    console.log(`[DEDUCT-BASIS] 차감기준 합계 매출 = "${revText}" (parsed=${revValue})`);
    expect(revValue).toBeGreaterThan(0); // ← 핵심: 0원이 아님(backfill 스냅샷 반영).
  });
});
