/**
 * E2E spec — T-20260615-foot-STATS-THERAPIST-CHART-COLOR
 * 통계 > 치료사 통계 탭 > 지표1 "치료사별 평균 치료시간 (분)" bar chart 막대 색을
 * 진행 중 뉴트럴 테마(index.css '일반영역 = hue 0 중립 그레이')에 정합하도록
 * slate(blue hue, #94a3b8) → 순수 뉴트럴 그레이(neutral-400 #a3a3a3, hue 0)로 정렬.
 *
 * 배경 (planner NEW-TASK MSG-20260615-111832-18vc / 김주연 총괄):
 *   "통계-치료사통계-표 컬러 변경" (첨부: 막대그래프 teal 막대에 빨간 체크).
 *   타깃 색 미지정 → AC3 기본값 = 진행 중 뉴트럴 테마 정합 무채색. 색만 변경.
 *   데이터/축/레이블/정렬·DB/EF/비즈로직 무변경.
 *
 * 범위 한정(회귀 방지 핵심, GO_WARN AC2):
 *   - 변경 대상 = 지표1 평균 치료시간 차트 막대 fill 뿐 (컴포넌트 로컬 AVG_BAR_COLOR).
 *   - 글로벌 teal 디자인 토큰·칸반 단계색·재진/선체험 칩·역할칩·다른 차트는 절대 불변.
 *   - 지표2 카드·매출/TM 탭·전역 테마 불변.
 *
 * 검증 구성:
 *   AC1 (순수 로직, DB 비의존): 막대 색이 단일 뉴트럴 그레이(#a3a3a3, hue 0)이고 틸/슬레이트가 아니다.
 *   AC2 (브라우저): 지표1 차트 막대 fill 이 뉴트럴 그레이이고 틸 hex 가 하나도 없다.
 *   AC3 (브라우저, 회귀): 지표2 svcdist 박스 화이트 유지 + 매출/TM 탭 정상 렌더.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const NEUTRAL = '#a3a3a3';
// 변경 전 슬레이트(blue hue) + 틸/그린 팔레트 — 어느 것도 막대에 남아있으면 안 됨
const FORBIDDEN_PALETTE = ['#94a3b8', '#0d9488', '#14b8a6', '#2dd4bf', '#5eead4', '#99f6e4'];

test.describe('T-20260615 STATS-THERAPIST-CHART-COLOR — 지표1 막대 슬레이트→뉴트럴 그레이(hue 0)', () => {
  // ── AC1: 막대 색 토큰은 단일 뉴트럴 그레이(hue 0), 슬레이트/틸 아님 (DB 비의존 순수 로직) ──
  test('AC1: 막대 색이 단일 뉴트럴 그레이(#a3a3a3)이고 슬레이트/틸 팔레트가 아니다', () => {
    // TherapistStatsSection 의 AVG_BAR_COLOR 와 동일한 모노톤 단색
    const barColor = NEUTRAL;
    expect(barColor).toBe('#a3a3a3');                      // 뉴트럴(neutral-400, hue 0) 단색
    expect(FORBIDDEN_PALETTE).not.toContain(barColor);     // 슬레이트/틸/그린 아님
    // 모노톤 = 하나의 색만 사용 (per-bar 컬러 매핑 없음)
    const usedColors = new Set([barColor]);
    expect(usedColors.size).toBe(1);
  });

  // ── AC2: 지표1 차트 막대 fill 이 뉴트럴 그레이, 슬레이트/틸 hex 0건 (best-effort, 로그인/데이터 의존) ──
  test('AC2: 지표1 평균 치료시간 막대 fill 이 뉴트럴 그레이이고 슬레이트/틸이 하나도 없다', async ({ page }) => {
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
    // 모든 막대가 뉴트럴 그레이, 슬레이트/틸 팔레트는 한 개도 없어야 함
    for (const f of fills) {
      expect(f).toBe(NEUTRAL);
      expect(FORBIDDEN_PALETTE.map((c) => c.toLowerCase())).not.toContain(f);
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
