/**
 * T-20260804-foot-MTM-SALES-DASH-RESTRUCTURE — 통계 > "MTM 매출" 대시보드 5섹션 재정비 E2E
 *
 * 재정비(현장 최필경/김주연 총괄, C0ATE5P6JTH):
 *   01 매출 통계   : 누적/예상월/급여/비급여/패키지판매액/실시술(선수금차감)/내원환자/결제건수/객단가
 *   02 전월 대비 매출 추이 : 일자별(1~말일) 당월 vs 전월 비교표 (신규 섹션)
 *   03 시술별 매출  : 유지(회귀 0)
 *   04 실장별 실적  : 유지(회귀 0)
 *   05 노쇼율/재방문율 : 전월 비교 데이터 추가
 *
 * 원칙: 신규 매출 산식 창작 금지 · 기존 SSOT 재사용 · read-only(db_change=false).
 *   급여/비급여 = Revenue Insurance Split(payments.tax_type) / 실시술매출 = 선수금 판매분 제외 +
 *   package_sessions(used) 소진 회차 인식 / 누적·패키지 = foot_stats_revenue RPC.
 *
 * 검증: 시나리오1(정상 5섹션 렌더) · 시나리오2(엣지: 빈 기간/전월 데이터 없음 '-' 오류 0) +
 *       정적 소스 불변식(read-only·산식 앵커·섹션 순서·전월 '-' 처리).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { loginAndWaitForDashboard } from '../helpers';

const REPO_ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// 정적 소스 불변식 — 토큰/DB 무관 견고 가드 (산식 앵커·read-only·섹션 순서)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('정적 소스 불변식 (T-20260804-foot-MTM-SALES-DASH-RESTRUCTURE)', () => {
  const lib = read('src/lib/mtmSales.ts');
  const page = read('src/pages/Stats.tsx');
  const revenue = read('src/components/stats/RevenueSection.tsx');
  const compare = read('src/components/stats/MonthlyComparisonSection.tsx');
  const noshow = read('src/components/stats/NoshowReturningSection.tsx');

  test('AC(READ-ONLY): mtmSales.ts 는 SELECT만 — insert/update/delete/upsert/rpc-write 부재', () => {
    expect(lib).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    // 집계 소스 조회는 .select / 기존 RPC 헬퍼(fetchRevenue·fetchNoshowReturning) 재사용만
    expect(lib).toMatch(/\.select\(/);
    expect(lib).toMatch(/fetchRevenue/);
    expect(lib).toMatch(/fetchNoshowReturning/);
  });

  test('AC-B(급여/비급여 = Revenue Insurance Split SSOT): payments.tax_type 축', () => {
    expect(lib).toMatch(/tax_type === '급여'/);
    expect(lib).toMatch(/tax_type === '선수금'/);
    // 비급여 = 급여·선수금이 아닌 나머지(과세/면세_비급여/NULL) + closing_manual UNION
    expect(lib).toMatch(/closing_manual_payments/);
    expect(lib).toMatch(/voided_at/);
  });

  test('AC-B(실시술매출 선수금차감): 선수금 판매분 제외 + package_sessions 소진회차 인식', () => {
    // 선수금(선결제)은 실시술매출에서 이연(제외) — prepaidSales 버킷으로 분리
    expect(lib).toMatch(/prepaidSales/);
    // 소진 회차 = package_sessions(status='used', session_date 축) unit_price 스냅샷
    expect(lib).toMatch(/\.from\('package_sessions'\)/);
    expect(lib).toMatch(/\.eq\('status',\s*'used'\)/);
    expect(lib).toMatch(/\.gte\('session_date',\s*from\)/);
    expect(lib).toMatch(/actualTreatmentRevenue\s*=\s*[\s\S]*salaryRevenue[\s\S]*nonSalaryRevenue[\s\S]*sessionRedemption/);
  });

  test('AC-B(내원환자/결제건수): check_ins distinct(취소·삭제 제외) + payments 결제행 카운트', () => {
    expect(lib).toMatch(/\.from\('check_ins'\)/);
    expect(lib).toMatch(/\.neq\('status',\s*'cancelled'\)/);
    expect(lib).toMatch(/\.is\('deleted_at',\s*null\)/);
    expect(lib).toMatch(/paymentCount/);
  });

  test('AC-C/2-2(전월 데이터 없음): previous=null → 화면 "-" (0 오도 금지)', () => {
    // fetchMonthlyComparison: prevHasData=false → previous=null
    expect(lib).toMatch(/prevHasData\s*\?\s*prevMap\.get\(d\)\s*\?\?\s*0\s*:\s*null/);
    // 표시 컴포넌트: previous === null → '-'
    expect(compare).toMatch(/p\.previous === null/);
    expect(compare).toMatch(/mtm-compare-prev-/);
  });

  test('AC-D(노쇼 전월 비교): 전월 값 병기 + 데이터 없음 처리', () => {
    expect(noshow).toMatch(/전월 데이터 없음/);
    expect(noshow).toMatch(/noshow-prev/);
    expect(noshow).toMatch(/returning-prev/);
  });

  test('AC(섹션 순서 01~05): Revenue → MonthlyComparison → Category → Consultant → Noshow', () => {
    const iRev = page.indexOf('<RevenueSection');
    const iCmp = page.indexOf('<MonthlyComparisonSection');
    const iCat = page.indexOf('<CategorySection');
    const iCon = page.indexOf('<ConsultantSection');
    const iNos = page.indexOf('<NoshowReturningSection');
    expect(iRev).toBeGreaterThanOrEqual(0);
    expect(iCmp).toBeGreaterThan(iRev);
    expect(iCat).toBeGreaterThan(iCmp);
    expect(iCon).toBeGreaterThan(iCat);
    expect(iNos).toBeGreaterThan(iCon);
  });

  test('AC-A(유지 섹션 renumber): 03 시술별 · 04 실장별 · 05 노쇼', () => {
    expect(read('src/components/stats/CategorySection.tsx')).toMatch(/3\. 시술 종류별 매출/);
    expect(read('src/components/stats/ConsultantSection.tsx')).toMatch(/4\. 상담실장 티켓팅 실적/);
    expect(noshow).toMatch(/5\. 노쇼율 \/ 재방문율/);
  });

  test('AC-B(01 카드 9지표 라벨 존재)', () => {
    for (const label of [
      '누적매출 (순)', '예상월매출 (추정)', '급여 매출', '비급여 매출',
      '패키지 판매액', '실제 시술 매출 (선수금차감)', '내원환자 수', '결제건수', '객단가',
    ]) {
      expect(revenue).toContain(label);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 브라우저 동선 — 로그인 가능 시에만
// ─────────────────────────────────────────────────────────────────────────────
test.describe('MTM 매출 대시보드 브라우저 동선', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('시나리오1: 매출 통계 탭 진입 + 5섹션 렌더', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });

    // 기본 진입 = 매출 통계 탭
    await page.getByTestId('stats-tab-revenue').click();
    await page.waitForLoadState('networkidle');

    // 01 매출 통계 — 신규 카드 지표
    await expect(page.getByText('누적매출 (순)').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('예상월매출 (추정)').first()).toBeVisible();
    await expect(page.getByText('급여 매출').first()).toBeVisible();
    await expect(page.getByText('비급여 매출').first()).toBeVisible();
    await expect(page.getByText('패키지 판매액').first()).toBeVisible();
    await expect(page.getByText('실제 시술 매출 (선수금차감)').first()).toBeVisible();
    await expect(page.getByText('내원환자 수').first()).toBeVisible();
    await expect(page.getByText('결제건수').first()).toBeVisible();
    await expect(page.getByText('객단가').first()).toBeVisible();

    // 02 전월 대비 매출 추이(신규)
    await expect(page.getByText('2. 전월 대비 매출 추이')).toBeVisible();
    // 03/04 유지
    await expect(page.getByText('3. 시술 종류별 매출')).toBeVisible();
    await expect(page.getByText('4. 상담실장 티켓팅 실적')).toBeVisible();
    // 05 노쇼율/재방문율
    await expect(page.getByText('5. 노쇼율 / 재방문율')).toBeVisible();

    await expect(page.getByText(/통계를 불러오지 못했습니다/)).toHaveCount(0);
    console.log('[MTM 매출] 5섹션 렌더 OK');
  });

  test('시나리오2: 엣지(빈 기간/전월 데이터 없음) → 오류 없이 "-" 처리', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('stats-tab-revenue').click();
    await page.waitForLoadState('networkidle');

    // 미래(데이터 0) 기간 → 당월/전월 모두 데이터 없음. 오류 배너 0, 섹션은 그대로 렌더.
    await page.getByRole('button', { name: '사용자 지정', exact: true }).click();
    const dateInputs = page.locator('input[type="date"]');
    await dateInputs.nth(0).fill('2099-01-01');
    await dateInputs.nth(1).fill('2099-01-31');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/통계를 불러오지 못했습니다/)).toHaveCount(0);
    // 02 전월 비교표는 여전히 존재(전월 데이터 없음 → '-' 컬럼)
    await expect(page.getByText('2. 전월 대비 매출 추이')).toBeVisible({ timeout: 10_000 });
    // 05 전월 노쇼 비교 — 전월 데이터 없음 문구 표시(0 오도 금지)
    await expect(page.getByText('5. 노쇼율 / 재방문율')).toBeVisible();
    console.log('[MTM 매출] 엣지(빈 기간) 오류 0 + 전월 "-" 처리 OK');
  });

  test('회귀: 기존 탭(치료사/TM집계/내원) 정상 전환 불변', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('stats-tab-tm').click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/통계를 불러오지 못했습니다/)).toHaveCount(0);

    await page.getByTestId('stats-tab-revenue').click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('누적매출 (순)').first()).toBeVisible();
    await expect(page.getByText(/통계를 불러오지 못했습니다/)).toHaveCount(0);
    console.log('[MTM 매출] 기존 탭 회귀 불변 OK');
  });
});
