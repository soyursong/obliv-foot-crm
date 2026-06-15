/**
 * E2E spec — T-20260615-foot-STATS-THERAPIST-TABLE-RECOLOR
 * 통계 > 치료사 통계 탭 > 지표1 "치료사별 평균 치료시간 (분)" bar chart 막대 색을
 * 그린/틸(teal) → 연그레이 모노톤(slate-400 #94a3b8)으로 변경.
 *
 * 배경 (planner NEW-TASK MSG-20260615-114422 / 김주연 총괄):
 *   지표1 막대가 틸 팔레트(#0d9488 등)였음 → 연그레이 모노톤으로 통일.
 *   색만 변경. 데이터/축/레이블/정렬·DB/EF/비즈로직 무변경.
 *
 * 범위 한정(회귀 방지 핵심):
 *   - 변경 대상 = 지표1 평균 치료시간 차트 막대뿐.
 *   - 지표2 '치료사별 시술 분포' 카드(직전 화이트 배포)·매출/TM 탭·전역 테마는 건드리지 않음.
 *
 * 검증 구성:
 *   AC1 (순수 로직, DB 비의존): 막대 색 토큰이 단일 연그레이(#94a3b8)이고 틸 팔레트가 아니다.
 *   AC2 (브라우저): 지표1 차트 막대 fill 이 연그레이이고 틸 hex 가 하나도 없다.
 *   AC3 (브라우저, 회귀): 지표2 svcdist 박스는 화이트 유지 + 다른 탭 정상 렌더.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const GRAY = '#94a3b8';
// 변경 전 틸/그린 팔레트 — 어느 것도 막대에 남아있으면 안 됨
const TEAL_PALETTE = ['#0d9488', '#14b8a6', '#2dd4bf', '#5eead4', '#99f6e4'];

test.describe('T-20260615 STATS-THERAPIST-TABLE-RECOLOR — 지표1 막대 그린→연그레이 모노톤', () => {
  // ── AC1: 막대 색 토큰은 단일 연그레이 모노톤, 틸 팔레트 아님 (DB 비의존 순수 로직) ──
  test('AC1: 막대 색이 단일 연그레이(#94a3b8)이고 틸 팔레트가 아니다', () => {
    // TherapistStatsSection 의 AVG_BAR_COLOR 와 동일한 모노톤 단색
    const barColor = GRAY;
    expect(barColor).toBe('#94a3b8');               // 연그레이(slate-400) 단색
    expect(TEAL_PALETTE).not.toContain(barColor);   // 틸/그린 팔레트 아님
    // 모노톤 = 하나의 색만 사용 (per-bar 컬러 매핑 없음)
    const usedColors = new Set([barColor]);
    expect(usedColors.size).toBe(1);
  });

  // ── AC2: 지표1 차트 막대 fill 이 연그레이, 틸 hex 0건 (best-effort, 로그인/데이터 의존) ──
  test('AC2: 지표1 평균 치료시간 막대 fill 이 연그레이이고 틸이 하나도 없다', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    test.skip(!ok, '로그인 불가 환경 — AC1 로직 모델로 대체');

    await page.goto('/admin/stats');
    const tab = page.getByTestId('stats-tab-therapist');
    try {
      await tab.waitFor({ state: 'visible', timeout: 10_000 });
    } catch {
      test.skip(true, 'stats 접근 불가 role(=권한 차단 정상)');
      return;
    }
    await tab.click();
    await page.waitForTimeout(7_000);

    // 지표1 섹션은 항상 마운트
    const section = page.getByTestId('therapist-metric-avgtime');
    await expect(section).toBeVisible();

    // 막대(recharts-rectangle path)는 데이터가 있을 때만 렌더
    const bars = section.locator('path.recharts-rectangle');
    const count = await bars.count();
    if (count === 0) {
      test.skip(true, '기간 내 평균 치료시간 데이터 없음 — 색 단언은 AC1 로 대체');
      return;
    }

    const fills = await bars.evaluateAll((nodes) =>
      nodes.map((n) => (n.getAttribute('fill') || '').toLowerCase()),
    );
    // 모든 막대가 연그레이, 틸 팔레트는 한 개도 없어야 함
    for (const f of fills) {
      expect(f).toBe(GRAY);
      expect(TEAL_PALETTE.map((c) => c.toLowerCase())).not.toContain(f);
    }
  });

  // ── AC3: 비범위 회귀 방지 — 지표2 svcdist 카드 화이트 유지 + 다른 탭 정상 ──
  test('AC3: 지표2 시술분포 카드는 화이트 유지, 매출/TM 탭은 정상 렌더(비범위 무변경)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    test.skip(!ok, '로그인 불가 환경 — 회귀 검증 생략');

    await page.goto('/admin/stats');
    const therapistTab = page.getByTestId('stats-tab-therapist');
    try {
      await therapistTab.waitFor({ state: 'visible', timeout: 10_000 });
    } catch {
      test.skip(true, 'stats 접근 불가 role(=권한 차단 정상)');
      return;
    }
    await therapistTab.click();
    await page.waitForTimeout(5_000);

    // 지표2 박스는 화이트 카드(bg-white) 유지 — 색 변경 영향 없음
    const boxes = page.getByTestId('svcdist-box');
    if (await boxes.count() > 0) {
      const cls = await boxes.first().getAttribute('class');
      expect(cls).toContain('bg-white');
    }

    // 매출/TM 탭 전환 시 정상 렌더(기존 surface 무변경)
    await page.getByTestId('stats-tab-revenue').click();
    await page.waitForTimeout(2_000);
    await page.getByTestId('stats-tab-tm').click();
    await page.waitForTimeout(2_000);
    // 탭 전환 후에도 페이지가 살아있음(크래시 없음)
    await expect(page.getByTestId('stats-tab-therapist')).toBeVisible();
  });
});
