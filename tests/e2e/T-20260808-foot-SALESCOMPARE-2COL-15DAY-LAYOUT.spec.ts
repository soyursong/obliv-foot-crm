/**
 * T-20260808-foot-SALESCOMPARE-2COL-15DAY-LAYOUT — 일자별 매출 비교(당월 vs 전월) 좌우 2단 재배치 E2E
 *
 * 무엇: 통계>MTM매출 02섹션 + 일마감 '매출 비교' 탭이 공유하는 MonthlyComparisonSection 의
 *   일자별 비교표를 좌우 2단으로 재배치 — 좌 = 1~15일, 우 = 16~말일(30/31·2월 28/29 동적).
 *
 * AC:
 *   AC-2 말일 robust : 우측 끝날짜는 data.points(=말일까지) 기준 동적, 하드코딩 31 금지.
 *   AC-3 값 불변     : 산식/집계/합계/증감 무접촉(mtmSales SSOT 발산 금지, db_change=false).
 *   AC-4 단일 소스   : 공유 컴포넌트 1곳만 수정 → Stats.tsx + Closing.tsx(매출비교 탭) 동시 반영.
 *   AC-5 반응형      : 기본 세로 스택(좌 1~15 → 우 16~말일 순), md↑ 좌우 2열.
 *
 * 검증: 정적 소스 불변식(레이아웃 분할·동적말일·값 무접촉·단일소스) + 런타임 렌더(2단 + 합계 1회).
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
test.describe('정적 소스 불변식 (T-20260808-foot-SALESCOMPARE-2COL-15DAY-LAYOUT)', () => {
  const compare = read('src/components/stats/MonthlyComparisonSection.tsx');
  const lib = read('src/lib/mtmSales.ts');

  test('AC-2/2단 분할: 좌 day<=15 / 우 day>=16 필터로 분할', () => {
    expect(compare).toMatch(/data\.points\.filter\(\(p\)\s*=>\s*p\.day\s*<=\s*15\)/);
    expect(compare).toMatch(/data\.points\.filter\(\(p\)\s*=>\s*p\.day\s*>=\s*16\)/);
  });

  test('AC-2/말일 robust: 하드코딩 31 없음 — 끝날짜는 points(말일까지) 기준 동적', () => {
    // 우측 끝을 31로 고정하는 리터럴 슬라이스/비교가 없어야 함(2월/짧은달 깨짐 방지).
    expect(compare).not.toMatch(/day\s*<=\s*31/);
    expect(compare).not.toMatch(/day\s*>=\s*31/);
    expect(compare).not.toMatch(/slice\(\s*15\s*,\s*31\s*\)/);
    // 말일 도출은 mtmSales(daysInMonth = new Date(y, m, 0)) SSOT — 컴포넌트가 임의 재계산하지 않음.
    expect(lib).toMatch(/new Date\(y,\s*m,\s*0\)\.getDate\(\)/);
  });

  test('AC-3/값 무접촉: 합계·증감 산식 불변(당월−전월) + read-only 유지', () => {
    // 합계는 curMonthTotal/prevMonthTotal 그대로 소비(재계산 없음).
    expect(compare).toMatch(/formatAmount\(data\.curMonthTotal\)/);
    expect(compare).toMatch(/data\.curMonthTotal\s*-\s*data\.prevMonthTotal/);
    // 증감 = 당월 − 전월(각 행).
    expect(compare).toMatch(/p\.current\s*-\s*p\.previous/);
    // 표시 컴포넌트에 write/집계 로직 유입 금지.
    expect(compare).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/);
    expect(lib).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });

  test('AC-3/합계 1회: mtm-compare-total-cur / -prev 각 1회만(중복 렌더 금지)', () => {
    expect((compare.match(/data-testid="mtm-compare-total-cur"/g) ?? []).length).toBe(1);
    expect((compare.match(/data-testid="mtm-compare-total-prev"/g) ?? []).length).toBe(1);
  });

  test('AC-5/반응형: grid-cols-1 → md:grid-cols-2 스택 fallback', () => {
    expect(compare).toMatch(/grid-cols-1/);
    expect(compare).toMatch(/md:grid-cols-2/);
  });

  test('AC-4/단일 소스: 공유 컴포넌트를 Stats.tsx + Closing.tsx 가 함께 소비', () => {
    const stats = read('src/pages/Stats.tsx');
    const closing = read('src/pages/Closing.tsx');
    expect(stats).toMatch(/MonthlyComparisonSection/);
    expect(closing).toMatch(/MonthlyComparisonSection/);
  });

  test('회귀: 컨테이너 testid + 행/전월 testid + 헤더 4종 유지', () => {
    expect(compare).toMatch(/data-testid="mtm-monthly-compare"/);
    expect(compare).toMatch(/mtm-compare-row-\$\{p\.day\}/);
    expect(compare).toMatch(/mtm-compare-prev-\$\{p\.day\}/);
    expect(compare).toMatch(/일자/);
    expect(compare).toMatch(/당월 매출/);
    expect(compare).toMatch(/전월 매출/);
    expect(compare).toMatch(/증감/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 런타임 렌더 — 통계 화면에서 2단 비교표 + 합계 1회 노출
// ─────────────────────────────────────────────────────────────────────────────
test.describe('런타임 렌더 (통계 > MTM 매출 2단 비교표)', () => {
  test('2단 반쪽 표(2개 thead) + 합계 1회 렌더 (또는 빈/로딩 상태 정상)', async ({ page }) => {
    try {
      await loginAndWaitForDashboard(page);
    } catch {
      test.skip(true, '로그인 실패 — 환경차');
      return;
    }
    await page.goto('/stats');
    await page.waitForLoadState('networkidle').catch(() => {});

    const container = page.getByTestId('mtm-monthly-compare');
    // 데이터 없음/로딩도 정상(권한·환경차).
    const hasContainer = (await container.count()) > 0;
    if (!hasContainer) {
      const emptyOrLoading =
        (await page.getByText('데이터 없음').count()) > 0 ||
        (await page.getByText('로딩 중').count()) > 0;
      expect(emptyOrLoading, '비교표 컨테이너 또는 빈/로딩 상태 렌더').toBeTruthy();
      return;
    }

    // 2단 = 반쪽 표 2개(각 thead 1개) → 컨테이너 내 thead >= 2.
    const theadCount = await container.locator('thead').count();
    expect(theadCount, '좌/우 2개 반쪽 표(thead 2)').toBeGreaterThanOrEqual(2);

    // 합계는 정확히 1회.
    await expect(page.getByTestId('mtm-compare-total-cur')).toHaveCount(1);
    await expect(page.getByTestId('mtm-compare-total-prev')).toHaveCount(1);
  });
});
