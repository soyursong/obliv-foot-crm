/**
 * E2E spec — T-20260701-foot-DOCROSTER-VCOMPACT-SIDEGAP-NAMEONLY
 * 사이드바 의사 근무표(DutyRosterTab, 원장×날짜 주간 그리드)에 대한 순수 FE 표시 조정 3건.
 * (형제 티켓 T-20260701-foot-DOCROSTER-COLWIDTH-COMPACT = 가로폭 컴팩트와 직교축 — 이미 배포됨, 회귀 0 유지)
 *
 * 변경(순수 FE CSS/레이아웃 + 표시문구 제거. DB=0 / 로직=0):
 *  (1) 세로 컴팩트 — 헤더 th py-1.5→py-1, 이름 td py-1→py-0.5, 셀 버튼 h-10→h-8.
 *      → 표 전체 세로 길이 감소(가로 아님).
 *  (2) 표 옆(좌우) 여백 확보 — 스크롤 컨테이너 좌우 내부여백(px-2)로 표와 테두리 사이 gap.
 *  (3) 셀/헤더 '원장님' 문구 완전 제거 → 의사 이름만 표시(좌상단 코너 헤더 공란).
 *
 * 진입점 = /admin/handover 상단 "의사 근무표" 섹션(DutyRosterTab).
 * 안정 selector: data-testid="duty-roster-grid"(table), "duty-roster-name-col"(코너 헤더).
 *
 * 시나리오(현장 클릭 3):
 *  1) AC3 NAMEONLY — 근무표 어디에도 '원장님' 라벨 텍스트가 없다(코너 헤더 공란) +
 *     본문 첫 열은 의사 이름만 렌더. (배너 '오늘 … 근무 원장님'은 표 셀/헤더가 아니므로 스코프 밖)
 *  2) AC1 세로 컴팩트 — 셀 토글 버튼 실측 높이 <= 34px(h-8=32px+테두리 여유), 옛 h-10(40px) 미만.
 *  3) AC2 옆 여백 + AC5 넘침0 — table 좌측이 스크롤 컨테이너 좌측보다 안쪽(px 여백 확보) +
 *     모든 헤더 셀 가로 넘침 0(글자 잘림/넘침 없음).
 *
 * ※ FE-only(SQL 0·DB 비파괴). 셀 실제 토글은 데이터 오염 방지로 트리거하지 않음.
 *   원장 0명/권한 환경은 graceful skip.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260701-foot-DOCROSTER-VCOMPACT-SIDEGAP-NAMEONLY — 근무표 세로컴팩트·옆여백·이름만', () => {
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

  test('시나리오1: AC3 이름만 — 그리드 코너 헤더 공란 + 첫 열 의사 이름만("원장님" 라벨 0)', async ({ page }) => {
    const grid = page.getByTestId('duty-roster-grid').first();
    if (!(await grid.isVisible().catch(() => false))) {
      test.skip(true, '원장 0명 — 근무 그리드 미렌더(빈상태)');
    }

    // 좌상단 코너 헤더에 '원장님' 텍스트가 남아있지 않다(완전 제거).
    const nameCol = page.getByTestId('duty-roster-name-col');
    await expect(nameCol).toBeVisible();
    const cornerText = ((await nameCol.textContent()) ?? '').trim();
    expect(cornerText).toBe('');
    console.log(`[시나리오1] 코너 헤더 텍스트=""(원장님 제거) OK`);

    // 그리드 표(thead+tbody) 내부에 '원장님' 문구가 하나도 없다.
    const rosterHasWonjangnim = await grid.evaluate((el) =>
      (el.textContent ?? '').includes('원장님'),
    );
    expect(rosterHasWonjangnim).toBe(false);
    console.log('[시나리오1] 근무표 그리드 내 "원장님" 문구 0건 OK');

    // 본문 첫 열 셀은 의사 이름(비어있지 않은 텍스트)만 렌더.
    const firstBodyNameCell = grid.locator('tbody tr').first().locator('td').first();
    const nm = ((await firstBodyNameCell.textContent()) ?? '').trim();
    expect(nm.length).toBeGreaterThan(0);
    expect(nm).not.toContain('원장님');
    console.log(`[시나리오1] 본문 첫 열 = "${nm}" (이름만) OK`);
  });

  test('시나리오2: AC1 세로 컴팩트 — 셀 토글 버튼 높이 <= 34px(옛 h-10=40px 미만)', async ({ page }) => {
    const grid = page.getByTestId('duty-roster-grid').first();
    if (!(await grid.isVisible().catch(() => false))) {
      test.skip(true, '원장 0명 — 근무 그리드 미렌더(빈상태)');
    }

    const cellBtn = grid.locator('tbody button').first();
    if (!(await cellBtn.isVisible().catch(() => false))) {
      test.skip(true, '토글 버튼 미렌더');
    }
    const h = (await cellBtn.boundingBox())?.height ?? 999;
    // h-8 = 2rem = 32px. 테두리/서브픽셀 여유로 34px 상한, 옛 h-10(40px) 미만.
    expect(h).toBeLessThanOrEqual(34);
    expect(h).toBeLessThan(40);
    console.log(`[시나리오2] 셀 버튼 높이=${Math.round(h)}px <= 34px (옛 40px 미만) OK`);
  });

  test('시나리오3: AC2 옆 여백 + AC5 넘침0 — table 좌측 안쪽 여백 + 헤더 셀 가로 넘침 0', async ({ page }) => {
    const grid = page.getByTestId('duty-roster-grid').first();
    if (!(await grid.isVisible().catch(() => false))) {
      test.skip(true, '원장 0명 — 근무 그리드 미렌더(빈상태)');
    }

    // (AC2) 스크롤 컨테이너(px-2) 안쪽으로 table 좌측이 들여져 옆 여백이 생긴다.
    const gap = await grid.evaluate((el) => {
      const container = el.parentElement as HTMLElement; // overflow-auto wrapper(px-2)
      const cRect = container.getBoundingClientRect();
      const tRect = (el as HTMLElement).getBoundingClientRect();
      return tRect.left - cRect.left; // 좌측 내부 여백(px)
    });
    expect(gap).toBeGreaterThanOrEqual(4); // px-2 = 0.5rem = 8px, 서브픽셀 여유로 4px 하한
    console.log(`[시나리오3] table 좌측 내부여백=${Math.round(gap)}px (>=4px, 옆 여백 확보) OK`);

    // (AC5) 모든 헤더 셀 가로 넘침(잘림) 0
    const headers = page.locator('[data-testid="duty-roster-grid"] thead th');
    const n = await headers.count();
    expect(n).toBeGreaterThanOrEqual(2); // 코너 + 최소 1개 날짜
    for (let i = 0; i < n; i++) {
      const overflow = await headers.nth(i).evaluate(
        (el) => (el as HTMLElement).scrollWidth - (el as HTMLElement).clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1); // 반올림 여유 1px
    }
    console.log(`[시나리오3] 헤더 셀 ${n}개 가로 넘침 0(잘림 없음) OK`);

    // 날짜 헤더(M.d) 텍스트 온전 표시 — 회귀 0 확인
    const dateCell = page.locator('[data-testid="duty-roster-grid"] thead th').filter({ hasText: /\d+\.\d+/ }).first();
    await expect(dateCell).toBeVisible();
    console.log('[시나리오3] 날짜 헤더(M.d) 온전 표시 OK');
  });
});
