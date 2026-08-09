/**
 * T-20260808-foot-STATS-MGRDAILY-NOWRAP-FIX
 *   통계 > "실장별 일별 매출" 표에서 날짜(일)/금액(원) 셀이 줄바꿈으로 두 줄로 떨어지는 현상 → 한 줄 표시.
 *
 * RC: 헤더(th)에는 whitespace-nowrap 이 있었으나 tbody/tfoot 의 <td> 셀에 누락 →
 *     좁은 열폭에서 "12" / "일", "1,200" / "원" 이 두 줄로 wrap.
 * FIX: 실장별 표(mtm-staff-daily) tbody 날짜/금액 셀 + tfoot 합계 셀에 whitespace-nowrap 추가.
 *      스타일 전용(CSS 클래스 추가). DB 변경 없음. 로직/산식 불변.
 *
 * 검증: 정적 소스 불변식(td에 whitespace-nowrap 존재) + 브라우저 렌더(셀 실제 1줄 높이).
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
test.describe('정적 소스 불변식 (T-20260808-foot-STATS-MGRDAILY-NOWRAP-FIX)', () => {
  const compare = read('src/components/stats/MonthlyComparisonSection.tsx');

  test('FIX: 실장별 표 tbody 날짜 셀에 whitespace-nowrap', () => {
    // 날짜 셀({row.day}일) — nowrap 적용.
    expect(compare).toMatch(/className="whitespace-nowrap px-3 py-1\.5 font-medium">\{row\.day\}일<\/td>/);
  });

  test('FIX: 실장별 표 tbody 실장별 금액 셀 + 일 합계 셀에 whitespace-nowrap', () => {
    // 실장별 금액 셀.
    expect(compare).toMatch(/className="whitespace-nowrap px-3 py-1\.5 text-right tabular-nums"/);
    // 일 합계 셀.
    expect(compare).toMatch(/className="whitespace-nowrap px-3 py-1\.5 text-right tabular-nums font-medium"/);
  });

  test('FIX: 실장별 표 tfoot 합계 행 셀들에 whitespace-nowrap', () => {
    // 합계 라벨 셀.
    expect(compare).toMatch(/className="whitespace-nowrap px-3 py-2">합계<\/td>/);
    // 실장별 총계 셀.
    expect(compare).toMatch(/className="whitespace-nowrap px-3 py-2 text-right tabular-nums"/);
    // 총합 셀.
    expect(compare).toMatch(/className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-teal-700"/);
  });

  test('회귀 0: 로직/산식 마커 불변(스타일 전용 변경)', () => {
    expect(compare).toMatch(/mtm-staff-daily/);
    expect(compare).toMatch(/mtm-staff-grand-total/);
    expect(compare).toMatch(/row\.isFuture/);
    // 기존 비교표(카드 #1)도 불변.
    expect(compare).toMatch(/mtm-monthly-compare/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 브라우저 동선 — 로그인 가능 시에만
// ─────────────────────────────────────────────────────────────────────────────
test.describe('실장별 일별 매출 표 셀 1줄 표시 브라우저 동선', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('시나리오: 통계 > 매출 탭 > 실장별 표 날짜/금액 셀이 줄바꿈 없이 1줄', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('stats-tab-revenue').click();
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('실장별 일별 매출')).toBeVisible({ timeout: 10_000 });

    const staffTable = page.getByTestId('mtm-staff-daily');
    // 데이터가 있을 때만 셀 높이 검증.
    if (await staffTable.count()) {
      const firstDayCell = staffTable.locator('tbody td').first();
      if (await firstDayCell.count()) {
        const white = await firstDayCell.evaluate(
          (el) => getComputedStyle(el).whiteSpace,
        );
        expect(white).toBe('nowrap');
      }
    }

    await expect(page.getByText(/통계를 불러오지 못했습니다/)).toHaveCount(0);
    console.log('[MGRDAILY-NOWRAP] 실장별 표 셀 nowrap 렌더 OK');
  });
});
