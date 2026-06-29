/**
 * T-20260629-foot-SALESDOCTOR-INS-SPLIT (TK-ACC-2 ①)
 * 매출집계 탭4(담당실장별) — 공단부담액 소스 교체 E2E
 *
 * 산식 정본: agents/docs/revenue_insurance_split_spec.md §2 (DA SSOT)
 *
 * 현장 클릭 시나리오(티켓 본문) → E2E 변환:
 *   시나리오 1: 의사별 매출 공단부담액 표시
 *     - 매출 → 담당실장별 진입, 최근 1개월
 *     - "공단부담액(명세)" 컬럼 노출 + 라벨 변경("공단청구액(EDI)" 아님)
 *     - "할인 미반영" 안내 노출
 *   시나리오 2: 비급여 수기수납 UNION 반영 (closing_manual_payments 포함)
 *   시나리오 3: 엣지 — 명세 없는 의사 → 공단부담액 0, 에러 없음
 *
 * 빈 데이터(staging DB)에서는 empty state / 컬럼 헤더 검증으로 대체.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const SALES_URL = '/admin/sales';
const TAB_NAME = '담당실장별';

async function gotoDoctorTab(page: import('@playwright/test').Page) {
  await page.goto(SALES_URL);
  // 페이지 헤딩으로 한정 — '매출집계'는 nav 링크 + h1 헤딩 2곳에 존재(strict mode 위반 방지)
  await expect(page.getByRole('heading', { name: '매출집계' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('tab', { name: TAB_NAME }).click();
  // 탭 패널이 terminal 상태에 도달할 때까지 대기 — loading 소멸 + (table | empty) 렌더.
  // React Query 재시도 backoff 로 loading 이 길어질 수 있어 충분히 대기(레이스 제거).
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

test.describe('T-20260629-foot-SALESDOCTOR-INS-SPLIT 공단부담액 소스 교체', () => {
  // gotoDoctorTab 의 loading→terminal 대기 + Supabase 쿼리 지연(React Query 재시도 backoff)을
  // 흡수하기 위해 기본 30s → 60s. QA-host 네트워크 변동성에도 안정.
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded — auth 실패');
  });

  // ── 시나리오 1: 라벨 정정 (AC-2) ─────────────────────────────────────────
  test('AC-2: 헤더 라벨 "공단부담액 (명세)" 노출 + "공단청구액 (EDI)" 제거', async ({ page }) => {
    await gotoDoctorTab(page);

    if (!(await hasTable(page))) {
      console.log('[INS-SPLIT] empty state — 라벨 검증 skip');
      await expect(page.locator('[data-testid="sales-doctor-empty"]')).toBeVisible();
      return;
    }

    const tableEl = page.locator('[data-testid="sales-doctor-tab"]');
    // 신규 라벨 노출 (컬럼 헤더로 한정 — 푸터 주석에도 유사 문구 존재)
    await expect(tableEl.getByRole('columnheader', { name: '공단부담액 (명세)' })).toBeVisible();
    // 구 라벨(EDI) 제거 확인
    await expect(tableEl.getByText('공단청구액 (EDI)')).toHaveCount(0);
    console.log('[INS-SPLIT] AC-2 라벨 정정 OK');
  });

  // ── 시나리오 1: 할인 미반영 명시 라벨 (AC-5) ──────────────────────────────
  test('AC-5: "할인 미반영" 안내 문구 노출', async ({ page }) => {
    await gotoDoctorTab(page);

    if (!(await hasTable(page))) {
      console.log('[INS-SPLIT] empty state — 할인 미반영 라벨 skip');
      return;
    }

    await expect(page.getByText('할인 미반영')).toBeVisible();
    // 명세 추정값 안내(공단 심사 전)도 함께 노출
    await expect(page.getByText(/공단부담액\(명세\)/)).toBeVisible();
    console.log('[INS-SPLIT] AC-5 할인 미반영 안내 OK');
  });

  // ── 시나리오 1: 공단부담액 컬럼 값 — 0 하드코딩(—) 제거 (AC-1) ────────────
  test('AC-1: 공단부담액 셀/합계가 "원" 금액 포맷으로 렌더(— 하드코딩 아님)', async ({ page }) => {
    await gotoDoctorTab(page);

    if (!(await hasTable(page))) {
      console.log('[INS-SPLIT] empty state — 공단부담액 셀 검증 skip');
      return;
    }

    // 합계 행 공단부담액 셀 존재 + "원" 포맷
    const totalCovered = page.locator('[data-testid="sales-doctor-total-covered"]');
    await expect(totalCovered).toBeVisible();
    await expect(totalCovered).toContainText('원');

    // 행별 공단부담액 셀도 "원" 포맷(— 단독 아님)
    const rowCovered = page.locator('[data-testid^="sales-doctor-covered-"]').first();
    if (await rowCovered.isVisible().catch(() => false)) {
      await expect(rowCovered).toContainText('원');
    }
    console.log('[INS-SPLIT] AC-1 공단부담액 금액 포맷 렌더 OK');
  });

  // ── 시나리오 2 & AC-3/AC-4: 5개 컬럼(비급여 UNION 반영 후에도 구조 유지) ───
  test('AC-3/4: 헤더 5컬럼(담당실장·오더건수·비급여·급여본부금·공단부담액) 구조 유지', async ({ page }) => {
    await gotoDoctorTab(page);

    if (!(await hasTable(page))) {
      console.log('[INS-SPLIT] empty state — 컬럼 구조 검증 skip');
      return;
    }

    const tableEl = page.locator('[data-testid="sales-doctor-tab"]');
    // 컬럼 헤더는 columnheader role 로 한정 — 본문/푸터 주석에도 같은 단어가 등장(strict 위반 방지)
    await expect(tableEl.getByRole('columnheader', { name: '담당실장' })).toBeVisible();
    await expect(tableEl.getByRole('columnheader', { name: '오더 건수' })).toBeVisible();
    await expect(tableEl.getByRole('columnheader', { name: '비급여 순매출' })).toBeVisible();
    await expect(tableEl.getByRole('columnheader', { name: '급여 본부금' })).toBeVisible();
    await expect(tableEl.getByRole('columnheader', { name: '공단부담액 (명세)' })).toBeVisible();

    // 비급여/공단부담 합계 셀 동시 존재 (UNION·명세 병합 후 집계)
    await expect(page.locator('[data-testid="sales-doctor-total-nonins"]')).toBeVisible();
    await expect(page.locator('[data-testid="sales-doctor-total-covered"]')).toBeVisible();
    console.log('[INS-SPLIT] AC-3/4 컬럼 구조 + 합계 셀 OK');
  });

  // ── 시나리오 3: 엣지 — 데이터 없어도 에러 없이 렌더 ───────────────────────
  test('시나리오3: 명세 없는 상태에서도 에러 없이 렌더(table or empty)', async ({ page }) => {
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
    console.log(`[INS-SPLIT] 시나리오3 무에러 렌더 OK — table:${table} empty:${empty}`);
  });

  // ── 회귀: 기간 프리셋 + 검색 필터 (기존 동작 유지) ────────────────────────
  test('회귀: 이번달 프리셋 + 의사명 검색 필터 동작 유지', async ({ page }) => {
    await gotoDoctorTab(page);

    const monthBtn = page.locator('[data-testid="sales-preset-month"]');
    await expect(monthBtn).toBeVisible();
    await monthBtn.click();
    // @base-ui Tabs 는 data-state 가 아니라 aria-selected/data-selected 사용 → 선택 상태는 aria-selected 로 검증
    await expect(page.getByRole('tab', { name: TAB_NAME })).toHaveAttribute('aria-selected', 'true');

    const searchInput = page.locator('[data-testid="sales-search"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('존재하지않는의사이름XXXXXXX');

    // 검색 후 terminal 상태 대기 — 매칭 0건이면 표의 행이 0 이거나 empty 로 수렴.
    // 즉시 isVisible 레이스 대신 명시적 수렴 대기(필터 디바운스/재렌더 흡수).
    await expect
      .poll(
        async () => {
          const emptyVisible = await page
            .locator('[data-testid="sales-doctor-empty"]')
            .isVisible()
            .catch(() => false);
          if (emptyVisible) return 'empty';
          const tableVisible = await page
            .locator('[data-testid="sales-doctor-tab"]')
            .isVisible()
            .catch(() => false);
          if (tableVisible) {
            const rows = await page.locator('[data-testid^="sales-doctor-row-"]').count();
            return rows === 0 ? 'empty-table' : 'has-rows';
          }
          return 'pending';
        },
        { timeout: 10_000 },
      )
      // 존재하지 않는 의사명 → 매칭 0 → empty 또는 0행 테이블 (필터 동작 확인)
      .not.toBe('has-rows');

    await searchInput.fill('');
    console.log('[INS-SPLIT] 회귀 프리셋+검색 OK');
  });
});
