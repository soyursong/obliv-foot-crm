/**
 * T-20260708-foot-TMSTATS-PERIOD-DEFAULT-TODAY — TM집계 탭 기간 기본값 '오늘' E2E spec
 *
 * 통계 대시보드 > TM집계 탭 기간 필터 기본값을 '오늘(당일)'로 변경.
 * (기존: 전 탭 공유 preset 기본값 '이번 달')
 *
 * 검증 대상:
 *   시나리오 1 (TM집계 최초 진입 → '오늘' 기본):
 *     - TM집계 탭 진입 시 기간 프리셋이 '오늘'로 활성화 (AC-1)
 *   시나리오 2 (타 탭 기본값 불변):
 *     - 매출/치료사 탭은 기존 기본값 '이번 달' 유지 (AC-2)
 *   시나리오 3 (재진입 리셋):
 *     - TM집계에서 기간을 '이번 달'로 바꾼 뒤 타 탭 이동 → TM집계 재진입 시 '오늘'로 리셋 (AC-3)
 *
 * 정적 소스 불변식(무회귀 가드):
 *     - tm 전용 tmPreset('today') 분리 상태 존재
 *     - 타 탭 공유 preset 기본값 'month' 불변
 *     - 집계 산식/데이터소스/컬럼 무변경(초기값만 조정) → fetchTmAggregate 호출·컬럼 불변
 *
 * READ-ONLY — DB 변경 없음.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { loginAndWaitForDashboard } from '../helpers';

const REPO_ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// 정적 소스 불변식 — TM집계만 '오늘' 기본, 타 탭 'month' 불변, 산식 무변경
// ─────────────────────────────────────────────────────────────────────────────
test.describe('정적 소스 불변식 — TM집계 기간 기본값 오늘 (T-20260708)', () => {
  const src = read('src/pages/Stats.tsx');

  test('AC1: tm 전용 preset(tmPreset) 기본값이 오늘(today)', () => {
    expect(src).toMatch(/tmPreset[\s\S]{0,60}useState<StatsRangePreset>\('today'\)/);
  });

  test('AC2 무회귀: 타 탭 공유 preset 기본값은 이번 달(month) 불변', () => {
    expect(src).toMatch(/\[preset,\s*setPreset\]\s*=\s*useState<StatsRangePreset>\('month'\)/);
  });

  test('AC3: tm 탭 진입 시 tmPreset 을 today 로 리셋(tab 변화에만 반응)', () => {
    // tab === 'tm' 일 때 setTmPreset('today')
    expect(src).toMatch(/if\s*\(tab\s*===\s*'tm'\)\s*setTmPreset\('today'\)/);
  });

  test('활성 preset 분기: tm 탭은 tmPreset, 그 외는 공유 preset', () => {
    expect(src).toMatch(/activePreset\s*=\s*tab\s*===\s*'tm'\s*\?\s*tmPreset\s*:\s*preset/);
  });

  test('산식/데이터소스 무변경: fetchTmAggregate 호출·기간(from/to) 파라미터 불변', () => {
    // 집계 산식·소스는 그대로 — 기간 초기값만 조정
    expect(src).toMatch(/fetchTmAggregate\(clinic\.id,\s*from,\s*to\)/);
    // 기간 계산은 activePreset 기준으로 resolveRange
    expect(src).toMatch(/resolveRange\(activePreset,\s*customFrom,\s*customTo\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 브라우저 동작 — 활성 프리셋 버튼(활성 클래스 bg-teal-50/text-teal-700)로 판정
// ─────────────────────────────────────────────────────────────────────────────
test.describe('TM집계 기간 기본값 오늘 — 브라우저 동작', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  const activeClass = /bg-teal-50/;

  test('시나리오1: TM집계 탭 진입 → 기간 프리셋 "오늘" 활성', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('stats-tab-tm').click();
    await page.waitForLoadState('networkidle');

    // '오늘' 버튼이 활성(강조) 상태
    const todayBtn = page.getByRole('button', { name: '오늘', exact: true });
    await expect(todayBtn).toHaveClass(activeClass);
    // 헤더 기간 라벨: 당일 시작=끝(from===to) 형태로 노출됨
    await expect(page.getByText(/기간: \d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}/)).toBeVisible();
    console.log('[TM집계] 최초 진입 → 오늘 기본값 활성 OK');
  });

  test('시나리오2: 매출 통계 탭은 기본값 "이번 달" 유지(불변)', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });
    // 최초 탭 = 매출 통계 → '이번 달' 활성
    const monthBtn = page.getByRole('button', { name: '이번 달', exact: true });
    await expect(monthBtn).toHaveClass(activeClass);
    console.log('[매출통계] 기본값 이번 달 유지 OK');
  });

  test('시나리오3: 기간 변경 후 타 탭 이동 → TM집계 재진입 시 "오늘"로 리셋', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });

    // TM집계 진입 → 오늘 활성
    await page.getByTestId('stats-tab-tm').click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: '오늘', exact: true })).toHaveClass(activeClass);

    // 기간을 '이번 달'로 변경
    await page.getByRole('button', { name: '이번 달', exact: true }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: '이번 달', exact: true })).toHaveClass(activeClass);

    // 타 탭(매출 통계)로 이동 후 다시 TM집계 재진입
    await page.getByTestId('stats-tab-revenue').click();
    await page.waitForLoadState('networkidle');
    await page.getByTestId('stats-tab-tm').click();
    await page.waitForLoadState('networkidle');

    // 재진입 시 '오늘'로 리셋
    await expect(page.getByRole('button', { name: '오늘', exact: true })).toHaveClass(activeClass);
    console.log('[TM집계] 재진입 리셋 → 오늘 OK');
  });
});
