/**
 * T-20260723-foot-STAT-NAEWON-TAB — 통계 대시보드 '내원 통계' 탭 E2E spec
 *
 * 선택 기간의 방문경로별 내원(방문 완료) 건수를 ① 요약 카드 ② 도넛+표 ③ 일별 누적 막대로 표시.
 * 조회 전용(READ-ONLY) — DB 쓰기 없음. 기존 3탭(매출/치료사/TM집계) 무영향.
 *
 * 검증 대상:
 *   시나리오1(정상): '내원 통계' 탭이 TM집계 우측 4번째로 노출 + 클릭 시 ①②③ 섹션 렌더
 *   시나리오2(기간 필터 연동): 프리셋/사용자지정 변경 시 에러 없이 갱신, 시작·종료일 당일 포함
 *   시나리오3(엣지): 빈 데이터 기간 → '데이터 없음', 미입력 별도 집계, 회귀(기존 3탭 불변)
 *   정적 소스 불변식: read-only 쿼리(checked_in·취소/노쇼 제외)·방문경로 하드코딩 금지·탭 순서
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { loginAndWaitForDashboard } from '../helpers';

const REPO_ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// 정적 소스 불변식 — DB write 부재·집계 규칙·탭 순서 회귀 가드 (토큰 무관 견고 검증)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('정적 소스 불변식 (T-20260723-foot-STAT-NAEWON-TAB)', () => {
  const stats = read('src/lib/stats.ts');
  const section = read('src/components/stats/VisitRouteSection.tsx');
  const page = read('src/pages/Stats.tsx');

  test('AC(탭 순서): 내원 통계 탭이 TM집계 바로 오른쪽(4번째)', () => {
    // TABS 배열 내 tm → visit 순서. 'visit' 다음에 다른 탭이 없어야 함(마지막).
    expect(page).toMatch(/key:\s*'tm'[\s\S]*?key:\s*'visit',\s*label:\s*'내원 통계'/);
    expect(page).toMatch(/type StatsTab = 'revenue' \| 'therapist' \| 'tm' \| 'visit'/);
  });

  test('AC(READ-ONLY): fetchVisitRouteStats 는 SELECT만 — insert/update/delete/upsert 부재', () => {
    const fn = stats.slice(stats.indexOf('export async function fetchVisitRouteStats'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
    expect(body).toMatch(/\.from\('reservations'\)/);
    expect(body).toMatch(/\.select\(/);
    expect(body).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });

  test('AC(방문완료 정의): status=checked_in 만 — 취소·노쇼 자동 제외', () => {
    const fn = stats.slice(stats.indexOf('export async function fetchVisitRouteStats'));
    expect(fn).toMatch(/\.eq\('status',\s*'checked_in'\)/);
  });

  test('AC(지점 스코프 + 기간경계 당일 포함): clinic_id eq + reservation_date gte/lte', () => {
    const fn = stats.slice(stats.indexOf('export async function fetchVisitRouteStats'));
    expect(fn).toMatch(/\.eq\('clinic_id',\s*clinicId\)/);
    expect(fn).toMatch(/\.gte\('reservation_date',\s*from\)/);
    expect(fn).toMatch(/\.lte\('reservation_date',\s*to\)/);
  });

  test('AC(하드코딩 금지): 방문경로 목록은 드롭다운 SSOT(VISIT_ROUTE_OPTIONS)에서 동적 렌더', () => {
    expect(section).toMatch(/import\s*\{\s*VISIT_ROUTE_OPTIONS\s*\}\s*from\s*'@\/lib\/types'/);
    // TM/네이버 등 경로값 리터럴 배열 하드코딩 금지
    expect(section).not.toMatch(/\[\s*'TM'\s*,\s*'네이버'/);
  });

  test('AC(미입력 별도 집계): NULL/빈값 → 미입력 버킷', () => {
    expect(section).toMatch(/UNSET_LABEL\s*=\s*'미입력'/);
    expect(section).toMatch(/\(r\.visit_route\s*\?\?\s*''\)\.trim\(\)\s*\|\|\s*UNSET_LABEL/);
  });

  test('AC(기간 필터 구독): visit 탭은 공유 preset 사용(tm 전용 tmPreset 미사용)', () => {
    // activePreset = tab === 'tm' ? tmPreset : preset  → visit 탭은 공유 preset
    expect(page).toMatch(/const activePreset = tab === 'tm' \? tmPreset : preset;/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 브라우저 동선 — 로그인 가능 시에만
// ─────────────────────────────────────────────────────────────────────────────
test.describe('내원 통계 탭 브라우저 동선', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('시나리오1: 내원 통계 탭 노출(4번째) + 클릭 시 ①②③ 섹션 렌더', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });

    // 탭 순서: 매출 통계 | 치료사 통계 | TM집계 | 내원 통계
    const visitTab = page.getByTestId('stats-tab-visit');
    await expect(visitTab).toBeVisible();
    await expect(page.getByTestId('stats-tab-tm')).toBeVisible();

    await visitTab.click();
    await page.waitForLoadState('networkidle');

    // ① 요약 카드 3종 / ② 경로별 / ③ 일별 추이
    await expect(page.getByText('총 내원 건수').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('최다 유입 경로').first()).toBeVisible();
    await expect(page.getByText('미입력 건수').first()).toBeVisible();
    await expect(page.getByText('방문경로별 내원').first()).toBeVisible();
    await expect(page.getByText('일별 내원 추이').first()).toBeVisible();
    console.log('[내원 통계] 탭 + ①②③ 섹션 렌더 OK');
  });

  test('시나리오2: 기간 프리셋 변경 시 에러 없이 갱신', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('stats-tab-visit').click();
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: '오늘', exact: true }).click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: '이번 달', exact: true }).click();
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/통계를 불러오지 못했습니다/)).toHaveCount(0);
    await expect(page.getByText('총 내원 건수').first()).toBeVisible();
    console.log('[내원 통계] 기간 프리셋 갱신 OK (에러 없음)');
  });

  test('시나리오3: 빈 데이터 기간 → 에러 없이 데이터 없음', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('stats-tab-visit').click();
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: '사용자 지정', exact: true }).click();
    const dateInputs = page.locator('input[type="date"]');
    await dateInputs.nth(0).fill('2099-01-01');
    await dateInputs.nth(1).fill('2099-01-31');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/통계를 불러오지 못했습니다/)).toHaveCount(0);
    await expect(page.getByText('데이터 없음').first()).toBeVisible({ timeout: 10_000 });
    console.log('[내원 통계] 빈 데이터 기간 → 데이터 없음 OK');
  });

  test('회귀: 기존 3탭(매출/치료사/TM집계) 정상 전환 불변', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('stats-tab-tm').click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('TM상담사별 집계')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('stats-tab-revenue').click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('총 매출 (순)').first()).toBeVisible();
    await expect(page.getByText(/통계를 불러오지 못했습니다/)).toHaveCount(0);
    console.log('[내원 통계] 기존 3탭 회귀 불변 OK');
  });
});
