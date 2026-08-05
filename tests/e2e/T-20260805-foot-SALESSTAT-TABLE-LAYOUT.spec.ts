/**
 * T-20260805-foot-SALESSTAT-TABLE-LAYOUT
 * 통계 > MTM 매출 > "01 매출통계" 섹션만 개별 박스/카드 → 표(테이블) 레이아웃 전환 E2E spec.
 *
 * 극협소 스코프: 01 섹션 프레젠테이션(카드→표)만. 산식·데이터·02~05 섹션 무접촉.
 *
 * AC:
 *   AC-A: 01 매출통계 카드 → 표 전환. 좌=구분(항목명), 우=값. 급여/비급여=합계|급여|비급여 열 분리.
 *   AC-B: 산식·데이터 소스 무변경(프레젠테이션 only) — 값 계산 로직(누적/객단가/급여 split) 불변.
 *   AC-C: 02~05 섹션 무접촉(RevenueSection.tsx 외 stats 컴포넌트 미수정) — 회귀 0.
 *   AC-D: 01 최상단 목표매출/달성률(형제 티켓 deployed) 보존 — Stats.tsx 마운트 순서 유지.
 *   AC-E: 본 spec(시나리오 1·2 변환).
 *
 * ※ RevenueSection = 인증 토큰 뒤 대시보드. 견고성 위해 정적 소스 불변식 + 라이브 렌더 스모크 병행
 *   (형제 SALESSTAT-MONTHLY-TARGET-ACHIEVEMENT spec 컨벤션 준용).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { loginAndWaitForDashboard } from '../helpers';

const REPO_ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// 정적 소스 불변식 — 카드→표 전환 · 값 회귀0 · 급여/비급여 열분리 · 스코프 경계
// ─────────────────────────────────────────────────────────────────────────────
test.describe('정적 소스 불변식 (SALESSTAT-TABLE-LAYOUT)', () => {
  const section = read('src/components/stats/RevenueSection.tsx');
  const page = read('src/pages/Stats.tsx');

  test('AC-A(카드→표): 01 매출통계가 <table>(요약 표)로 렌더 — KpiCard 그리드 폐기', () => {
    // 요약 표 존재
    expect(section).toMatch(/<table/);
    expect(section).toMatch(/data-testid="revenue-summary-table"/);
    // 헤더 = 구분 | 합계 | 급여 | 비급여
    expect(section).toMatch(/>구분</);
    expect(section).toMatch(/>합계</);
    expect(section).toMatch(/>급여</);
    expect(section).toMatch(/>비급여</);
    // 기존 KpiCard 다중 그리드 마크업 제거(카드→표 전환 완료)
    expect(section).not.toMatch(/<KpiCard/);
    expect(section).not.toMatch(/function KpiCard/);
  });

  test('AC-A(급여/비급여 열분리): split 행 = 합계|급여|비급여 3열, 합계=급여+비급여 정합', () => {
    // 급여/비급여 값 셀 분리
    expect(section).toMatch(/data-testid="revenue-salary"/);
    expect(section).toMatch(/data-testid="revenue-nonsalary"/);
    // 합계 = 급여 + 비급여 (AC 정합)
    expect(section).toMatch(/salarySplitTotal\s*=\s*metrics\s*\?\s*metrics\.salaryRevenue\s*\+\s*metrics\.nonSalaryRevenue\s*:\s*null/);
    // split 행 정의 존재
    expect(section).toMatch(/kind:\s*'split'/);
    expect(section).toMatch(/급여 · 비급여 매출/);
  });

  test('AC-B(산식 무변경): 누적매출·객단가·급여/비급여 계산식이 부모 배포본과 동일', () => {
    // 누적매출(순) = pkg + single − refund (SSOT 불변)
    expect(section).toMatch(/total:\s*pkg\s*\+\s*single\s*-\s*refund/);
    // 객단가 = 누적매출 ÷ 내원환자, 0 나눗셈 가드
    expect(section).toMatch(/metrics\.visitPatients\s*<=\s*0\)\s*return null/);
    expect(section).toMatch(/totals\.total\s*\/\s*metrics\.visitPatients/);
    // 급여/비급여/실시술/내원/결제 = metrics SSOT 그대로 소비
    expect(section).toMatch(/metrics\.salaryRevenue/);
    expect(section).toMatch(/metrics\.nonSalaryRevenue/);
    expect(section).toMatch(/metrics\.actualTreatmentRevenue/);
    expect(section).toMatch(/metrics\.visitPatients/);
    expect(section).toMatch(/metrics\.paymentCount/);
    // 데이터 소스 재정의 없음 — metrics 는 props 로만 수신(자체 fetch/supabase 호출 부재)
    expect(section).not.toMatch(/supabase|useEffect\(|fetch\(/);
  });

  test('AC-B(값 회귀0): 기존 카드 전 지표가 표 행으로 보존(누락 없음)', () => {
    const expectedRows = [
      '누적매출 (순)',
      '예상월매출 (추정)',
      '급여 · 비급여 매출',
      '패키지 판매액',
      '단건 매출',
      '실제 시술 매출 (선수금차감)',
      '환불액',
      '내원환자 수',
      '결제건수',
      '객단가',
    ];
    for (const label of expectedRows) {
      expect(section).toContain(label);
    }
    // null → '-'(회귀 0, 기존 KpiCard 동작 준용)
    expect(section).toMatch(/value === null/);
  });

  test('AC-B(추이 차트 보존): 일별 매출 추이 라인차트 유지', () => {
    expect(section).toMatch(/일별 매출 추이/);
    expect(section).toMatch(/<LineChart/);
  });

  test('AC-C(스코프 경계): RevenueSection 외 02~05 stats 컴포넌트 import/수정 없음', () => {
    // 본 컴포넌트가 다른 섹션(월비교·시술별·실장별·노쇼)을 건드리지 않음
    expect(section).not.toMatch(/MonthlyComparisonSection|CategorySection|ConsultantSection|TherapistStatsSection|NoshowReturningSection/);
  });

  test('AC-D(목표/달성률 보존): Stats.tsx 목표카드→매출섹션 마운트 순서 유지', () => {
    expect(page).toMatch(/import MonthlyTargetSection from '@\/components\/stats\/MonthlyTargetSection'/);
    const frag = page.slice(page.indexOf("tab === 'revenue' ?"));
    const mIdx = frag.indexOf('<MonthlyTargetSection');
    const rIdx = frag.indexOf('<RevenueSection');
    expect(mIdx).toBeGreaterThanOrEqual(0);
    expect(rIdx).toBeGreaterThan(mIdx); // 목표카드 → 매출섹션 순서 불변
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 브라우저 동선 — 로그인 가능 시에만 (표 렌더 + 목표카드 보존 스모크)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('01 매출통계 표 브라우저 동선', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('시나리오1: 01 매출통계가 표(테이블) 형태로 렌더', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });
    // 요약 표 렌더
    const table = page.getByTestId('revenue-summary-table');
    await expect(table.first()).toBeVisible({ timeout: 10_000 });
    // 헤더 열 = 구분/합계/급여/비급여
    await expect(table.getByText('구분').first()).toBeVisible();
    await expect(table.getByText('합계').first()).toBeVisible();
    // 통계 로드 에러 배너 없음(회귀 가드)
    await expect(page.getByText(/통계를 불러오지 못했습니다/)).toHaveCount(0);
    console.log('[SALESSTAT-TABLE] 01 매출통계 표 렌더 OK');
  });

  test('AC-D 시나리오2: 01 최상단 목표매출/달성률 보존', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });
    // 표 전환 후에도 목표매출/달성률 유지(유실 없음)
    await expect(page.getByText('이번 달 목표 매출').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('monthly-target-achievement').first()).toBeVisible();
    console.log('[SALESSTAT-TABLE] 목표매출/달성률 보존 OK');
  });

  test('회귀: 급여/비급여 열분리 + 일별 추이 차트 정상 렌더', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });
    // 급여·비급여 매출 행 렌더(합계|급여|비급여)
    await expect(page.getByText('급여 · 비급여 매출').first()).toBeVisible({ timeout: 10_000 });
    // 추이 차트 회귀 없음
    await expect(page.getByText('일별 매출 추이').first()).toBeVisible();
    console.log('[SALESSTAT-TABLE] 급여/비급여 열분리 + 추이차트 회귀 없음 OK');
  });
});
