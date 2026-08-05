/**
 * T-20260805-foot-DAILYTREND-STAFF-BREAKDOWN-CLARIFY
 *   부모 T-20260804-foot-MTM-SALES-DASH-RESTRUCTURE(02 일별 매출 추이) 후속 개선.
 *   현장 원문(최필경/김주연 총괄, C0ATE5P6JTH):
 *     "일별 매출 추이 = 실장별로 표 넣어주고 지금 표는 어떤 내용을 말하는건지 알아보기 어려움"
 *
 * 두 가지:
 *   (AC-A) 실장별 표 추가 — 일별 매출 추이를 담당실장 단위로도 표시(기존 비교표 대체 아님·추가).
 *          실장별 총매출 = SALESAGG-STAFF-4METRIC-REDEFINE(deployed) 정의(패키지 결제 합산 +
 *          급여 본인부담금 합산)를 **일자 grain**으로 재사용. 신규 산식 창작 금지.
 *          담당실장 귀속 = customers.assigned_staff_id, 미지정 매출 = '미지정' 버킷.
 *   (AC-B) 가독성 — 컬럼 헤더에 단위(원)·의미 명시 + "이 표 읽는 법" 범례.
 *
 * read-only(db_change=false). 검증: 정적 소스 불변식 + 시나리오1(정상)·2(엣지).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { loginAndWaitForDashboard } from '../helpers';

const REPO_ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// 정적 소스 불변식 — 토큰/DB 무관 견고 가드
// ─────────────────────────────────────────────────────────────────────────────
test.describe('정적 소스 불변식 (T-20260805-foot-DAILYTREND-STAFF-BREAKDOWN-CLARIFY)', () => {
  const lib = read('src/lib/mtmSales.ts');
  const compare = read('src/components/stats/MonthlyComparisonSection.tsx');
  const page = read('src/pages/Stats.tsx');

  test('AC(READ-ONLY): 신규 헬퍼도 SELECT만 — write/rpc-write 부재', () => {
    expect(lib).toMatch(/fetchStaffDailyBreakdown/);
    // 파일 전체에 write 계열 부재(부모 불변식 유지).
    expect(lib).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });

  test('AC-A(산식 재사용): 실장별 총매출 = 패키지(선수금) + 급여 본인부담금, 신규 산식 창작 금지', () => {
    // 선수금(패키지) + 급여(본인부담금) 두 축만 집계 소스로 조회.
    expect(lib).toMatch(/\.in\('tax_type',\s*\['선수금',\s*'급여'\]\)/);
    // net = refund → 음수(환불 차감), accounting_date(판매/수납일) 축.
    expect(lib).toMatch(/payment_type === 'refund'/);
    expect(lib).toMatch(/accounting_date/);
  });

  test('AC-A(담당실장 귀속 grain): customers.assigned_staff_id + 미지정 버킷', () => {
    expect(lib).toMatch(/assigned_staff_id/);
    expect(lib).toMatch(/STAFF_BREAKDOWN_UNASSIGNED/);
    // 미지정 라벨 명시(누락·오귀속 금지).
    expect(lib).toMatch(/'미지정'/);
    // sim(테스트) 고객 방어필터 재사용.
    expect(lib).toMatch(/excludeSimulationPaymentRows/);
  });

  test('AC-A(현재월 미래일 0 오도 금지): isFuture → 표시 "-"', () => {
    expect(lib).toMatch(/isFuture/);
    expect(compare).toMatch(/row\.isFuture/);
    // 실장별 표 렌더 마커 + 합계.
    expect(compare).toMatch(/mtm-staff-daily/);
    expect(compare).toMatch(/mtm-staff-grand-total/);
  });

  test('AC-B(가독성): 컬럼 헤더 단위(원)·의미 + 읽는 법 범례', () => {
    expect(compare).toMatch(/당월 매출\(원\)/);
    expect(compare).toMatch(/전월 매출\(원\)/);
    expect(compare).toMatch(/증감\(당월−전월/);
    expect(compare).toMatch(/이 표 읽는 법/);
    expect(compare).toMatch(/mtm-compare-legend/);
  });

  test('AC-C(회귀 0): 기존 02 비교표 마커/합계 불변 + 실장별은 추가(대체 아님)', () => {
    // 기존 비교표 유지.
    expect(compare).toMatch(/mtm-monthly-compare/);
    expect(compare).toMatch(/mtm-compare-total-cur/);
    // 신규 실장별 표는 별도 Card로 추가.
    expect(compare).toMatch(/실장별 일별 매출/);
    // Stats.tsx 배선(staffBreakdown prop 전달).
    expect(page).toMatch(/fetchStaffDailyBreakdown/);
    expect(page).toMatch(/staffBreakdown=\{staffDaily\}/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 브라우저 동선 — 로그인 가능 시에만
// ─────────────────────────────────────────────────────────────────────────────
test.describe('일별 매출 추이 실장별 표 + 가독성 브라우저 동선', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('시나리오1: 매출 통계 탭 진입 → 02 섹션 실장별 표 + 가독성 범례 렌더', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('stats-tab-revenue').click();
    await page.waitForLoadState('networkidle');

    // 02 일별 매출 추이 섹션 존재.
    await expect(page.getByText('2. 전월 대비 매출 추이')).toBeVisible({ timeout: 10_000 });

    // (AC-B) 가독성 — "이 표 읽는 법" 범례 + 단위(원) 헤더.
    await expect(page.getByTestId('mtm-compare-legend')).toBeVisible();
    await expect(page.getByText('당월 매출(원)').first()).toBeVisible();

    // (AC-A) 실장별 일별 매출 표.
    await expect(page.getByText('실장별 일별 매출')).toBeVisible();
    await expect(page.getByTestId('mtm-staff-daily-note')).toBeVisible();

    await expect(page.getByText(/통계를 불러오지 못했습니다/)).toHaveCount(0);
    console.log('[DAILYTREND-STAFF] 실장별 표 + 가독성 범례 렌더 OK');
  });

  test('시나리오2: 엣지(빈 기간) → 실장별 표 데이터 없음/빈값 정상, 오류 0', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('stats-tab-revenue').click();
    await page.waitForLoadState('networkidle');

    // 미래(데이터 0) 기간 → 당월 데이터 0건. 실장별 표는 '데이터 없음' 또는 빈값으로 오류 없이 표시.
    await page.getByRole('button', { name: '사용자 지정', exact: true }).click();
    const dateInputs = page.locator('input[type="date"]');
    await dateInputs.nth(0).fill('2099-01-01');
    await dateInputs.nth(1).fill('2099-01-31');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/통계를 불러오지 못했습니다/)).toHaveCount(0);
    await expect(page.getByText('2. 전월 대비 매출 추이')).toBeVisible({ timeout: 10_000 });
    // 실장별 표 카드 타이틀은 여전히 존재(데이터 0이어도 섹션 렌더).
    await expect(page.getByText('실장별 일별 매출')).toBeVisible();
    console.log('[DAILYTREND-STAFF] 엣지(빈 기간) 오류 0 + 실장별 표 정상 렌더 OK');
  });

  test('회귀: 기존 02 비교표(당월 vs 전월) 불변', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('stats-tab-revenue').click();
    await page.waitForLoadState('networkidle');

    // 기존 일자별 비교표 마커 유지(대체 아님).
    await expect(page.getByTestId('mtm-monthly-compare')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/통계를 불러오지 못했습니다/)).toHaveCount(0);
    console.log('[DAILYTREND-STAFF] 기존 02 비교표 회귀 불변 OK');
  });
});
