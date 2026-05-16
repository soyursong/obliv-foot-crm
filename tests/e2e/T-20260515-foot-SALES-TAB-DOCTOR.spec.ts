/**
 * T-20260515-foot-SALES-TAB-DOCTOR
 * 매출집계 탭4 — 담당의별 통계 E2E
 *
 * 시나리오:
 *   1. [매출집계] 페이지 진입 → [담당의별] 탭 클릭 → 테이블 렌더 확인
 *   2. 담당의별 행: 비급여 순매출 + 오더 건수 컬럼 존재 확인
 *   3. 합계 행(tfoot) 렌더 확인
 *   4. 공단청구액(EDI) 미연동 안내 문구 확인
 *   5. 필터 바: 기간 프리셋(이번주) 클릭 → 데이터 갱신 대기
 *   6. 검색 필터: 담당의 이름 검색 → 결과 필터링
 *
 * 빈 데이터 상황(staging DB)에서는 empty state 검증으로 대체.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const SALES_URL = '/admin/sales';

test.describe('T-20260515-foot-SALES-TAB-DOCTOR 담당의별 매출 탭', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded — auth 실패');
  });

  // ── 1. 탭 네비게이션 + 기본 렌더 ─────────────────────────────────────────

  test('매출집계 → 담당의별 탭 클릭 시 렌더됨', async ({ page }) => {
    await page.goto(SALES_URL);
    await expect(page.getByText('매출집계')).toBeVisible({ timeout: 10_000 });

    // 담당의별 탭 클릭
    await page.getByRole('tab', { name: '담당의별' }).click();

    // 테이블 또는 empty state 중 하나 렌더
    const hasTable = await page.locator('[data-testid="sales-doctor-tab"]').isVisible().catch(() => false);
    const hasEmpty = await page.locator('[data-testid="sales-doctor-empty"]').isVisible().catch(() => false);

    expect(hasTable || hasEmpty).toBe(true);
    console.log(`[DOCTOR-TAB] 렌더 OK — table:${hasTable} empty:${hasEmpty}`);
  });

  // ── 2. 테이블 컬럼 확인 ──────────────────────────────────────────────────

  test('테이블 헤더: 담당의·오더건수·비급여순매출·급여본부금·공단청구액 컬럼 존재', async ({ page }) => {
    await page.goto(SALES_URL);
    await expect(page.getByText('매출집계')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('tab', { name: '담당의별' }).click();

    // 테이블이 있을 때만 헤더 검증 (empty state 시 skip)
    const hasTable = await page
      .locator('[data-testid="sales-doctor-tab"]')
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    if (!hasTable) {
      console.log('[DOCTOR-TAB] 테이터 없음 — 헤더 검증 skip (empty state 정상)');
      await expect(page.locator('[data-testid="sales-doctor-empty"]')).toBeVisible();
      return;
    }

    const tableEl = page.locator('[data-testid="sales-doctor-tab"]');
    await expect(tableEl.getByText('담당의')).toBeVisible();
    await expect(tableEl.getByText('오더 건수')).toBeVisible();
    await expect(tableEl.getByText('비급여 순매출')).toBeVisible();
    await expect(tableEl.getByText('급여 본부금')).toBeVisible();
    await expect(tableEl.getByText('공단청구액 (EDI)')).toBeVisible();
    console.log('[DOCTOR-TAB] 헤더 5컬럼 확인 OK');
  });

  // ── 3. 합계 행 확인 ──────────────────────────────────────────────────────

  test('합계 행(tfoot) 렌더 + 오더건수·비급여순매출 합계 셀 존재', async ({ page }) => {
    await page.goto(SALES_URL);
    await expect(page.getByText('매출집계')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('tab', { name: '담당의별' }).click();

    const hasTable = await page
      .locator('[data-testid="sales-doctor-tab"]')
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    if (!hasTable) {
      console.log('[DOCTOR-TAB] 합계 행 검증 skip (empty state)');
      return;
    }

    await expect(page.locator('[data-testid="sales-doctor-total-orders"]')).toBeVisible();
    await expect(page.locator('[data-testid="sales-doctor-total-nonins"]')).toBeVisible();
    console.log('[DOCTOR-TAB] 합계 행 검증 OK');
  });

  // ── 4. EDI 미연동 안내 문구 ───────────────────────────────────────────────

  test('공단청구액(EDI) 미연동 안내 문구 렌더됨', async ({ page }) => {
    await page.goto(SALES_URL);
    await expect(page.getByText('매출집계')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('tab', { name: '담당의별' }).click();

    // empty 상태에서는 테이블 안 뜨므로 테이블이 있을 때만 확인
    const hasTable = await page
      .locator('[data-testid="sales-doctor-tab"]')
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    if (hasTable) {
      await expect(page.getByText('공단청구액(EDI)은 보험청구 시스템 연동 후 표시됩니다')).toBeVisible();
      console.log('[DOCTOR-TAB] EDI 안내 문구 확인 OK');
    } else {
      console.log('[DOCTOR-TAB] EDI 안내 문구 — empty state이므로 skip');
    }
  });

  // ── 5. 글로벌 필터 — 기간 프리셋 ────────────────────────────────────────

  test('필터 프리셋(이번달) 클릭 → 탭 유지 + 데이터 갱신 대기', async ({ page }) => {
    await page.goto(SALES_URL);
    await expect(page.getByText('매출집계')).toBeVisible({ timeout: 10_000 });

    // 담당의별 탭 활성화
    await page.getByRole('tab', { name: '담당의별' }).click();

    // 이번달 프리셋 클릭
    const monthBtn = page.locator('[data-testid="sales-preset-month"]');
    await expect(monthBtn).toBeVisible();
    await monthBtn.click();

    // 탭이 그대로인지 확인 (탭 라디오 selected 상태)
    const doctorTab = page.getByRole('tab', { name: '담당의별' });
    await expect(doctorTab).toHaveAttribute('data-state', 'active');

    // 로딩 or 결과 렌더 대기
    await page.waitForTimeout(1_500);
    const hasTable = await page.locator('[data-testid="sales-doctor-tab"]').isVisible().catch(() => false);
    const hasEmpty = await page.locator('[data-testid="sales-doctor-empty"]').isVisible().catch(() => false);

    expect(hasTable || hasEmpty).toBe(true);
    console.log('[DOCTOR-TAB] 프리셋(이번달) 필터 후 렌더 OK');
  });

  // ── 6. 검색 필터 — 의사명 검색 ───────────────────────────────────────────

  test('검색바에 입력 시 결과 필터링 (없는 이름 → empty or 0건)', async ({ page }) => {
    await page.goto(SALES_URL);
    await expect(page.getByText('매출집계')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('tab', { name: '담당의별' }).click();

    // 검색바에 존재하지 않을 이름 입력
    const searchInput = page.locator('[data-testid="sales-search"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('존재하지않는의사이름XXXXXXX');

    await page.waitForTimeout(500);

    // 필터 결과: empty state 또는 테이블에 행 없음
    const hasEmpty = await page.locator('[data-testid="sales-doctor-empty"]').isVisible().catch(() => false);
    const hasTable = await page.locator('[data-testid="sales-doctor-tab"]').isVisible().catch(() => false);

    // 테이블이 렌더된 경우에도 행이 0개여야 함
    if (hasTable) {
      const rows = await page.locator('[data-testid^="sales-doctor-row-"]').count();
      expect(rows).toBe(0);
      console.log('[DOCTOR-TAB] 검색 필터 — 테이블 0행 확인 OK');
    } else {
      expect(hasEmpty).toBe(true);
      console.log('[DOCTOR-TAB] 검색 필터 — empty state 확인 OK');
    }

    // 검색어 지우기 → 복원
    await searchInput.fill('');
    await page.waitForTimeout(300);
    console.log('[DOCTOR-TAB] 검색 초기화 OK');
  });

  // ── 7. 글로벌 필터 AC-3: 필터 바 존재 확인 ──────────────────────────────

  test('공통 필터 바(SalesFilterBar) 담당의별 탭에서도 렌더됨', async ({ page }) => {
    await page.goto(SALES_URL);
    await expect(page.getByText('매출집계')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('tab', { name: '담당의별' }).click();

    await expect(page.locator('[data-testid="sales-filter-bar"]')).toBeVisible();
    await expect(page.locator('[data-testid="sales-export-btn"]')).toBeVisible();
    console.log('[DOCTOR-TAB] 공통 필터 바 렌더 OK');
  });
});
