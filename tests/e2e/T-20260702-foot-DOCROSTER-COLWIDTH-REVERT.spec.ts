/**
 * E2E spec — T-20260702-foot-DOCROSTER-COLWIDTH-REVERT
 * 사이드바 의사 근무표(DutyRosterTab, 원장×날짜 주간 그리드)의 가로 폭 축소분 선택 원복.
 *
 * 배경: 형제 COLWIDTH(commit 2ae5697b)로 가로 칸너비를 축소했으나 현장(김주연 총괄)
 *   FIELD-SOAK 반려('옹졸해 보인다'). → 가로 폭 3종만 원복, 세로 컴팩트/문구제거는 유지.
 *
 * 변경(REVERT, 순수 FE CSS/레이아웃): 표시 내용·데이터·정렬/토글 로직 무변경.
 *  1) 그리드 <table> w-full 재적용 → 표가 스크롤 컨테이너 폭을 다시 채움(원래 넓은 폭).
 *  2) 이름 컬럼 고정폭 w-28(112px) 복원.
 *  3) 셀 좌우여백 px-3/px-2 복원(px-1.5 축소분 원복).
 *
 * KEEP(VCOMPACT 4ac5e8da 회귀 0): 세로 컴팩트(th py-1, 이름 td py-0.5, 셀 버튼 h-8),
 *   표 옆 여백(컨테이너 px-2), 헤더 '원장님' 라벨 제거(좌상단 코너 공란).
 *
 * 진입점 = /admin/handover 상단 "의사 근무표" 섹션(DutyRosterTab).
 *
 * 시나리오(AC 기준):
 *  1) AC1 가로 폭 복원: 근무표 <table> 실측 너비가 컨테이너 content box를 (거의) 채움
 *     (w-full 재적용). "이름" 헤더 셀 폭이 w-28(112px) 이상으로 복원.
 *  2) AC2 회귀 0: 헤더 셀 각각 scrollWidth <= clientWidth(글자 넘침·잘림 없음),
 *     날짜 헤더 텍스트(요일·M.d) 온전 표시.
 *  3) AC2/AC3 KEEP: 세로 컴팩트 유지(셀 버튼 높이 h-8≈32px) + 코너 '원장님' 문구 없음(이름만) +
 *     "근무 원장님" 배너 정상 렌더(데이터·토글 로직 무변경, DB 비오염).
 *
 * ※ FE-only(SQL 0·DB 비파괴). 원장 0명/권한 환경은 graceful skip.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260702-foot-DOCROSTER-COLWIDTH-REVERT — 의사 근무표 가로 폭 원복', () => {
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

  test('시나리오1: AC1 가로 폭 복원 — table w-full(컨테이너 폭 채움) + 이름 컬럼 w-28(112px) 이상', async ({ page }) => {
    const table = page.getByTestId('duty-roster-grid').first();
    if (!(await table.isVisible().catch(() => false))) {
      test.skip(true, '원장 0명 — 근무 그리드 미렌더(빈상태)');
    }

    // w-full 재적용 검증: table 실측 너비가 스크롤 컨테이너 content box(px-2 여백 제외)를 (거의) 채운다.
    const metrics = await table.evaluate((el) => {
      const container = el.parentElement as HTMLElement; // overflow-auto wrapper(px-2)
      const cs = getComputedStyle(container);
      const padL = parseFloat(cs.paddingLeft) || 0;
      const padR = parseFloat(cs.paddingRight) || 0;
      return {
        tableW: (el as HTMLElement).getBoundingClientRect().width,
        contentW: container.clientWidth - padL - padR, // 컨테이너 내부 가용 폭
      };
    });
    // COLWIDTH(auto-width)였다면 table < contentW로 좁았음. w-full 복원 시 content box를 채운다.
    expect(metrics.tableW).toBeGreaterThanOrEqual(metrics.contentW - 4); // 반올림/보더 여유 4px
    console.log(`[시나리오1] table=${Math.round(metrics.tableW)}px ≥ content=${Math.round(metrics.contentW)}px (w-full 폭 복원) OK`);

    // 이름 컬럼 폭이 w-28(112px) 이상으로 복원(옛 COLWIDTH에서는 112px 미만이었음).
    const nameHeader = page.getByTestId('duty-roster-name-col');
    const w = (await nameHeader.boundingBox())?.width ?? 0;
    expect(w).toBeGreaterThanOrEqual(110); // 112px - 2px 반올림 여유
    console.log(`[시나리오1] 이름 컬럼 폭=${Math.round(w)}px ≥ 112px(w-28 복원) OK`);
  });

  test('시나리오2: AC2 회귀 0 — 헤더 셀 scrollWidth<=clientWidth + 날짜 헤더 텍스트 온전', async ({ page }) => {
    const nameHeader = page.getByTestId('duty-roster-name-col');
    if (!(await nameHeader.isVisible().catch(() => false))) {
      test.skip(true, '원장 0명 — 근무 그리드 미렌더(빈상태)');
    }

    // 모든 컬럼 헤더 셀: 가로 넘침(잘림) 없음
    const headers = page.getByRole('columnheader');
    const n = await headers.count();
    expect(n).toBeGreaterThanOrEqual(2); // 이름 코너 + 최소 1개 날짜
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

  test('시나리오3: KEEP 회귀 0 — 세로 컴팩트(셀 버튼 h-8) 유지 + 코너 "원장님" 문구 제거 유지 + 배너 정상', async ({ page }) => {
    const table = page.getByTestId('duty-roster-grid').first();
    const gridVisible = await table.isVisible().catch(() => false);

    if (gridVisible) {
      // (KEEP-1) 세로 컴팩트: 근무 셀 버튼 높이가 h-8(≈32px) 이하로 유지(원복 대상 아님).
      const btn = table.locator('tbody button').first();
      if (await btn.isVisible().catch(() => false)) {
        const h = (await btn.boundingBox())?.height ?? 999;
        expect(h).toBeLessThanOrEqual(36); // h-8=32px + 보더/반올림 여유
        console.log(`[시나리오3] 셀 버튼 높이=${Math.round(h)}px ≤ 36px(h-8 세로 컴팩트 유지) OK`);
      }

      // (KEEP-2) 코너 이름 헤더에 '원장님' 문구 없음(이름만).
      const nameHeader = page.getByTestId('duty-roster-name-col');
      await expect(nameHeader).toHaveText('');
      console.log('[시나리오3] 코너 헤더 "원장님" 문구 제거 유지(공란) OK');
    } else {
      await expect(page.getByText('등록된 원장님이 없습니다')).toBeVisible();
      console.log('[시나리오3] 원장 0명 — 빈상태 정상 렌더');
    }

    // (AC3) "근무 원장님" 배너는 데이터 유무와 무관하게 항상 렌더.
    await expect(page.getByRole('heading', { name: /근무 원장님/ })).toBeVisible({ timeout: 5_000 });
    console.log('[시나리오3] "근무 원장님" 배너 정상 렌더(회귀 0) OK');
  });
});
