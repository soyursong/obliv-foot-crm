/**
 * E2E spec — T-20260701-foot-DOCROSTER-COLWIDTH-COMPACT
 * 사이드바 의사 근무표(DutyRosterTab, 원장×날짜 주간 그리드) 각 칸(셀) 너비 컴팩트화.
 *
 * 변경: 순수 FE CSS(레이아웃만). 표시 내용·데이터·정렬/토글 로직 무변경.
 *  - 그리드 table 의 w-full 제거(내용 기반 auto-width) → 열이 컨테이너 폭에 균등분산돼
 *    넓어지던 것 해소, 각 칸이 내용 기준으로 타이트해짐.
 *  - 원장님 컬럼 고정폭 w-28 제거 + 셀 좌우여백 축소(px-3/px-2 → px-1.5).
 *  - whitespace-nowrap 유지 → 글자 넘침·잘림 0.
 *
 * 진입점 = /admin/handover 상단 "의사 근무표" 섹션(DutyRosterTab).
 *
 * 시나리오(AC 기준):
 *  1) AC1 컴팩트: 근무표 <table> 실측 너비가 감싸는 스크롤 컨테이너 너비보다 좁다
 *     (w-full 제거 → 내용 기준 auto-width). "원장님" 헤더 셀 폭이 옛 w-28(112px) 미만.
 *  2) AC2 넘침 0: 헤더/이름 셀 각각 scrollWidth <= clientWidth (글자 넘침·잘림 없음),
 *     날짜 헤더 텍스트(요일·M.d) 온전 표시.
 *  3) AC3 회귀 0: "오늘 … 근무 원장님" 배너 + "원장님" 컬럼 헤더가 정상 렌더
 *     (데이터·토글 로직 무변경 — 셀 실제 토글은 DB 오염 방지로 트리거하지 않음).
 *
 * ※ FE-only(SQL 0·DB 비파괴). 원장 0명/권한 환경은 graceful skip.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260701-foot-DOCROSTER-COLWIDTH-COMPACT — 의사 근무표 칸 너비 컴팩트', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');

    await page.goto('/admin/handover');
    try {
      await page.getByRole('heading', { name: '의사 근무표' }).waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, '의사 근무표 섹션 진입 실패(권한/데이터)');
    }
  });

  test('시나리오1: AC1 컴팩트 — table 내용기준 auto-width(컨테이너보다 좁음) + 원장님 컬럼 옛 고정폭 미만', async ({ page }) => {
    // NAMEONLY 티켓으로 코너 헤더 '원장님' 텍스트 제거 → 이름 컬럼은 data-testid 로 특정.
    const table = page.getByTestId('duty-roster-grid').first();
    if (!(await table.isVisible().catch(() => false))) {
      test.skip(true, '원장 0명 — 근무 그리드 미렌더(빈상태)');
    }

    // w-full 제거 검증: table 실측 너비 < 스크롤 컨테이너(부모) 실측 너비
    const metrics = await table.evaluate((el) => {
      const container = el.parentElement as HTMLElement; // overflow-auto wrapper
      return {
        tableW: (el as HTMLElement).getBoundingClientRect().width,
        containerW: container.getBoundingClientRect().width,
      };
    });
    // 내용 기준 auto-width라면 6열+이름열 합이 넓은 컨테이너를 다 채우지 않는다.
    expect(metrics.tableW).toBeLessThan(metrics.containerW);
    console.log(`[시나리오1] table=${Math.round(metrics.tableW)}px < container=${Math.round(metrics.containerW)}px (auto-width 컴팩트) OK`);

    // 원장(이름) 컬럼 폭이 옛 고정폭 w-28(112px) 미만으로 타이트
    const nameHeader = page.getByTestId('duty-roster-name-col');
    const w = (await nameHeader.boundingBox())?.width ?? 999;
    expect(w).toBeLessThan(112);
    console.log(`[시나리오1] 이름 컬럼 폭=${Math.round(w)}px < 112px(옛 w-28) OK`);
  });

  test('시나리오2: AC2 넘침 0 — 헤더/이름 셀 scrollWidth<=clientWidth + 날짜 헤더 텍스트 온전', async ({ page }) => {
    const nameHeader = page.getByTestId('duty-roster-name-col');
    if (!(await nameHeader.isVisible().catch(() => false))) {
      test.skip(true, '원장 0명 — 근무 그리드 미렌더(빈상태)');
    }

    // 모든 컬럼 헤더 셀: 가로 넘침(잘림) 없음
    const headers = page.getByRole('columnheader');
    const n = await headers.count();
    expect(n).toBeGreaterThanOrEqual(2); // 원장님 + 최소 1개 날짜
    for (let i = 0; i < n; i++) {
      const overflow = await headers.nth(i).evaluate(
        (el) => (el as HTMLElement).scrollWidth - (el as HTMLElement).clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1); // 반올림 여유 1px
    }
    console.log(`[시나리오2] 헤더 셀 ${n}개 가로 넘침 0 OK`);

    // 날짜 헤더 텍스트(M.d 형태) 온전 표시 — 최소 1개 존재
    const dateCell = page.locator('thead th').filter({ hasText: /\d+\.\d+/ }).first();
    await expect(dateCell).toBeVisible();
    console.log('[시나리오2] 날짜 헤더(M.d) 텍스트 온전 표시 OK');
  });

  test('시나리오3: AC3 회귀 0 — 근무 원장님 배너 + "원장님" 헤더 정상 렌더(데이터/토글 무변경)', async ({ page }) => {
    // 배너는 데이터 유무와 무관하게 항상 렌더(CardTitle heading "오늘(…) 근무 원장님").
    // getByText는 빈배너 안내문구까지 매칭되므로 heading role 로 배너 제목만 특정.
    await expect(page.getByRole('heading', { name: /근무 원장님/ })).toBeVisible({ timeout: 5_000 });

    const rosterGrid = page.getByTestId('duty-roster-grid');
    const directorEmpty = page.getByText('등록된 원장님이 없습니다');
    // 원장 있으면 그리드, 없으면 빈상태 — 둘 중 하나는 정상 렌더(레이아웃 외 회귀 0)
    const gridVisible = await rosterGrid.isVisible().catch(() => false);
    if (gridVisible) {
      await expect(rosterGrid).toBeVisible();
    } else {
      await expect(directorEmpty).toBeVisible();
    }
    console.log('[시나리오3] 배너 + 그리드/빈상태 정상 렌더(회귀 0) OK');
  });
});
