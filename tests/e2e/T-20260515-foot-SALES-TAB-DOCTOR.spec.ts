/**
 * T-20260515-foot-SALES-TAB-DOCTOR
 * 매출집계 탭4 — 담당실장별 통계 E2E
 *
 * 시나리오:
 *   1. [매출집계] 페이지 진입 → [담당실장별] 탭 클릭 → 테이블 렌더 확인
 *   2. 담당실장별 행: 비급여 순매출 + 상담 건 수 컬럼 존재 확인
 *   3. 합계 행(tfoot) 렌더 확인
 *   4. 공단부담액(명세) 추정값 안내 문구 확인
 *   5. 필터 바: 기간 프리셋(이번주) 클릭 → 데이터 갱신 대기
 *   6. 검색 필터: 담당실장 이름 검색 → 결과 필터링
 *
 * 빈 데이터 상황(staging DB)에서는 empty state 검증으로 대체.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const SALES_URL = '/admin/sales';
const TAB_NAME = '담당실장별';

// 실서버 데이터 로딩(query) 대기 헬퍼 — sibling 통과 spec(INS-SPLIT/PKG/CONSULT-COUNT)과 동일 패턴.
//   탭 클릭 직후 로딩 스피너가 걷힐 때까지 대기(>5s 소요 가능) 후 table/empty 안착을 보장한다.
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

test.describe('T-20260515-foot-SALES-TAB-DOCTOR 담당실장별 매출 탭', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded — auth 실패');
  });

  // ── 1. 탭 네비게이션 + 기본 렌더 ─────────────────────────────────────────

  test('매출집계 → 담당실장별 탭 클릭 시 렌더됨', async ({ page }) => {
    await gotoDoctorTab(page);

    // 테이블 또는 empty state 중 하나 렌더 (gotoDoctorTab이 로딩 클리어까지 대기)
    const hasTable = await page.locator('[data-testid="sales-doctor-tab"]').isVisible().catch(() => false);
    const hasEmpty = await page.locator('[data-testid="sales-doctor-empty"]').isVisible().catch(() => false);

    expect(hasTable || hasEmpty).toBe(true);
    console.log(`[DOCTOR-TAB] 렌더 OK — table:${hasTable} empty:${hasEmpty}`);
  });

  // ── 2. 테이블 컬럼 확인 ──────────────────────────────────────────────────

  // LIVE 7컬럼(T-20260804 4METRIC-REDEFINE ②③④ + CONSULT-COUNT ① 반영):
  //   [담당실장, 상담 건 수, 비급여 순매출, 진찰료, 공단부담액 (명세), 패키지 (선수금), 총 매출]
  test('테이블 헤더: 담당실장·상담건수·비급여순매출·진찰료·공단부담액·패키지·총매출 7컬럼 존재', async ({ page }) => {
    await gotoDoctorTab(page);

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
    // columnheader role로 한정(본문/푸터 주석 동일 단어와 strict 충돌 방지)
    await expect(tableEl.getByRole('columnheader', { name: '담당실장' })).toBeVisible();
    await expect(tableEl.getByRole('columnheader', { name: '상담 건 수' })).toBeVisible();
    await expect(tableEl.getByRole('columnheader', { name: '비급여 순매출' })).toBeVisible();
    await expect(tableEl.getByRole('columnheader', { name: '진찰료' })).toBeVisible();
    await expect(tableEl.getByRole('columnheader', { name: '공단부담액 (명세)' })).toBeVisible();
    await expect(tableEl.getByRole('columnheader', { name: '패키지 (선수금)' })).toBeVisible();
    await expect(tableEl.getByRole('columnheader', { name: '총 매출' })).toBeVisible();
    await expect(tableEl.getByRole('columnheader')).toHaveCount(7);
    console.log('[DOCTOR-TAB] 헤더 7컬럼 확인 OK');
  });

  // ── 3. 합계 행 확인 ──────────────────────────────────────────────────────

  test('합계 행(tfoot) 렌더 + 상담건수·비급여순매출 합계 셀 존재', async ({ page }) => {
    await gotoDoctorTab(page);

    const hasTable = await page
      .locator('[data-testid="sales-doctor-tab"]')
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    if (!hasTable) {
      console.log('[DOCTOR-TAB] 합계 행 검증 skip (empty state)');
      return;
    }

    await expect(page.locator('[data-testid="sales-doctor-total-consultcount"]')).toBeVisible();
    await expect(page.locator('[data-testid="sales-doctor-total-nonins"]')).toBeVisible();
    console.log('[DOCTOR-TAB] 합계 행 검증 OK');
  });

  // ── 4. 공단부담액(명세) 추정값 안내 문구 (INS-SPLIT AC-2로 구 'EDI 미연동' 문구 대체) ──

  test('공단부담액(명세) 추정값 안내 문구 렌더됨', async ({ page }) => {
    await gotoDoctorTab(page);

    // empty 상태에서는 테이블 안 뜨므로 테이블이 있을 때만 확인
    const hasTable = await page
      .locator('[data-testid="sales-doctor-tab"]')
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    if (hasTable) {
      // 구 '공단청구액(EDI)은 보험청구 시스템 연동 후 표시됩니다' → INS-SPLIT AC-2 명세기준 추정값 문구로 대체
      await expect(page.getByText('공단부담액(명세)은 수가표 기준 추정값', { exact: false })).toBeVisible();
      console.log('[DOCTOR-TAB] 공단부담액(명세) 추정값 안내 문구 확인 OK');
    } else {
      console.log('[DOCTOR-TAB] 안내 문구 — empty state이므로 skip');
    }
  });

  // ── 5. 글로벌 필터 — 기간 프리셋 ────────────────────────────────────────

  test('필터 프리셋(이번달) 클릭 → 탭 유지 + 데이터 갱신 대기', async ({ page }) => {
    await gotoDoctorTab(page);

    // 이번달 프리셋 클릭
    const monthBtn = page.locator('[data-testid="sales-preset-month"]');
    await expect(monthBtn).toBeVisible();
    await monthBtn.click();

    // 탭이 그대로인지 확인 (선택 상태) — base-ui tab 마크업: aria-selected="true" / data-active.
    //   구 data-state="active"(radix)는 base-ui 마이그레이션으로 폐기 → aria-selected 표준으로 검증.
    const doctorTab = page.getByRole('tab', { name: '담당실장별' });
    await expect(doctorTab).toHaveAttribute('aria-selected', 'true');

    // 로딩 or 결과 렌더 대기
    await page.waitForTimeout(1_500);
    const hasTable = await page.locator('[data-testid="sales-doctor-tab"]').isVisible().catch(() => false);
    const hasEmpty = await page.locator('[data-testid="sales-doctor-empty"]').isVisible().catch(() => false);

    expect(hasTable || hasEmpty).toBe(true);
    console.log('[DOCTOR-TAB] 프리셋(이번달) 필터 후 렌더 OK');
  });

  // ── 6. 검색 필터 — 의사명 검색 ───────────────────────────────────────────

  test('검색바에 입력 시 결과 필터링 (없는 이름 → empty or 0건)', async ({ page }) => {
    await gotoDoctorTab(page);

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

  test('공통 필터 바(SalesFilterBar) 담당실장별 탭에서도 렌더됨', async ({ page }) => {
    await gotoDoctorTab(page);

    await expect(page.locator('[data-testid="sales-filter-bar"]')).toBeVisible();
    await expect(page.locator('[data-testid="sales-export-btn"]')).toBeVisible();
    console.log('[DOCTOR-TAB] 공통 필터 바 렌더 OK');
  });
});
