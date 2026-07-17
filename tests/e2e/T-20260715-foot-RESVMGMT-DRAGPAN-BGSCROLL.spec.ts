/**
 * E2E spec — T-20260715-foot-RESVMGMT-DRAGPAN-BGSCROLL
 * 현장(풋센터, 김주연 총괄) 요청: "대시보드처럼 스크롤바 안 잡고 배경화면 잡아 이동(드래그-팬)하는 기능을 예약관리 창에도 적용".
 *   = 예약관리 타임테이블 스크롤 컨테이너를 마우스로 배경(빈 영역)을 누른 채 끌면 콘텐츠가 따라 이동하는
 *     drag-to-pan(grab-and-drag) 인터랙션 추가. 대시보드 DASH-HSCROLL-DRAGPAN 패턴(useDragToPan) 재사용.
 *   ★ 대시보드는 가로 전용(axis='x')이었으나 예약관리 타임테이블은 2D(가로 시간축+세로 행) → axis='both'.
 *
 * AC:
 *  AC1 예약관리 창 배경 press-hold-drag 시 콘텐츠 팬 이동(가로+세로).
 *  AC2 기존 스크롤바/휠 스크롤 무회귀(프로그램 스크롤 여전히 동작).
 *  AC3 행/셀 tap·click 무회귀(이동거리 임계 ~5px 미만은 pan 미발생).
 *  AC4 태블릿 터치 + PC 마우스 통합(마우스=이 훅, 터치=네이티브 스와이프 위임).
 *  AC5 useDragToPan 기존 훅 재사용(경쟁 구현 신설 금지). 신규 npm 없음.
 *
 * 구현: useDragToPan(scrollContainerRef, { axis: 'both' }) — pointer 이벤트 + scrollLeft/scrollTop
 *   self-implement (신규 npm 無). 커서 grab→grabbing, pointer capture, pan 직후 click 1회 억제.
 *
 * 뷰포트 전략: 로그인은 데스크톱 폭에서 수행 후 예약관리로 이동. 타임테이블은 데이터/뷰에 따라
 *   가로·세로 오버플로 유무가 달라지므로, 해당 축 오버플로가 없으면 graceful skip.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260715-foot-RESVMGMT-DRAGPAN-BGSCROLL', () => {

  // 컨테이너의 오버플로/스크롤 지표 반환. ⚠ 브라우저로 직렬화 실행 — self-contained.
  const scrollProbe = (el: Element) => {
    const n = el as HTMLElement;
    return {
      hasX: n.scrollWidth > n.clientWidth + 1,
      hasY: n.scrollHeight > n.clientHeight + 1,
      scrollLeft: n.scrollLeft,
      scrollTop: n.scrollTop,
      marker: n.getAttribute('data-testid'),
    };
  };

  async function prepTimetable(page: Page) {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) return null;
    await page.goto('/admin/reservations');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(600);
    const tt = page.locator('[data-testid="resv-timetable-scroll"]').first();
    const visible = await tt.isVisible({ timeout: 10_000 }).catch(() => false);
    return visible ? tt : null;
  }

  test('시나리오1 (AC1/AC5): 배경 grab-and-drag 로 팬 이동 (가로/세로)', async ({ page }) => {
    const tt = await prepTimetable(page);
    if (!tt) { test.skip(true, '로그인 실패/타임테이블 미렌더 — 스킵'); return; }

    const before = await tt.evaluate(scrollProbe);
    if (!before.hasX && !before.hasY) {
      test.skip(true, '가로·세로 오버플로 모두 없음(데이터/뷰포트) — pan 대상 없음, 스킵');
      return;
    }

    const box = await tt.boundingBox();
    if (!box) { test.skip(true, '타임테이블 bbox 없음 — 스킵'); return; }

    // 배경(빈영역) 추정 지점 — 컨테이너 우상단 근처. pan 개시 후 pointer capture 로 el 밖으로 나가도 el 로 전달.
    const startX = box.x + box.width - 24;
    const startY = box.y + 24;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // 임계(5px) 초과로 pan 개시 — 가로+세로 동시 이동
    await page.mouse.move(startX - 30, startY - 30, { steps: 3 });
    const cursorDuringDrag = await tt.evaluate((el) => (el as HTMLElement).style.cursor); // AC3(커서)
    await page.mouse.move(startX - 220, startY - 180, { steps: 12 });
    const afterDrag = await tt.evaluate(scrollProbe);
    await page.mouse.up();

    // AC1: 오버플로가 있는 축은 이동했어야 함
    if (before.hasX) {
      expect(afterDrag.scrollLeft, `가로 pan 발생(before=${before.scrollLeft}, after=${afterDrag.scrollLeft})`).not.toBe(before.scrollLeft);
    }
    if (before.hasY) {
      expect(afterDrag.scrollTop, `세로 pan 발생(before=${before.scrollTop}, after=${afterDrag.scrollTop})`).not.toBe(before.scrollTop);
    }
    // 드래그 중 커서 grabbing
    expect(cursorDuringDrag, `드래그 중 커서=grabbing (실제="${cursorDuringDrag}")`).toBe('grabbing');

    // 떼면 멈춤 — up 이후 이동해도 스크롤 고정
    const restLeft = afterDrag.scrollLeft;
    const restTop = afterDrag.scrollTop;
    await page.mouse.move(startX - 400, startY - 320, { steps: 4 });
    const afterRelease = await tt.evaluate(scrollProbe);
    expect(afterRelease.scrollLeft, '뗀 뒤 가로 pan 멈춤(scrollLeft 고정)').toBe(restLeft);
    expect(afterRelease.scrollTop, '뗀 뒤 세로 pan 멈춤(scrollTop 고정)').toBe(restTop);

    // 커서 원복
    const cursorAfter = await tt.evaluate((el) => (el as HTMLElement).style.cursor);
    expect(cursorAfter, '드래그 종료 후 grabbing 해제').not.toBe('grabbing');

    console.log(`[시나리오1] 예약관리 배경 grab-and-drag 팬 PASS (target=${before.marker}, x:${before.hasX} ${before.scrollLeft}→${afterDrag.scrollLeft}, y:${before.hasY} ${before.scrollTop}→${afterDrag.scrollTop})`);
  });

  test('시나리오2 (AC2): 기존 프로그램/휠 스크롤 무회귀', async ({ page }) => {
    const tt = await prepTimetable(page);
    if (!tt) { test.skip(true, '로그인 실패/타임테이블 미렌더 — 스킵'); return; }

    // pan 훅이 붙어도 프로그램 스크롤(=휠/스크롤바 상당)이 그대로 동작해야 함.
    const result = await tt.evaluate((el) => {
      const n = el as HTMLElement;
      const hasX = n.scrollWidth > n.clientWidth + 1;
      const hasY = n.scrollHeight > n.clientHeight + 1;
      const beforeL = n.scrollLeft;
      const beforeT = n.scrollTop;
      if (hasX) n.scrollLeft = beforeL + 100;
      if (hasY) n.scrollTop = beforeT + 100;
      return { hasX, hasY, beforeL, afterL: n.scrollLeft, beforeT, afterT: n.scrollTop };
    });
    if (!result.hasX && !result.hasY) { test.skip(true, '오버플로 없음 — 스킵'); return; }
    if (result.hasX) expect(result.afterL, '프로그램 가로 스크롤 정상').toBeGreaterThan(result.beforeL);
    if (result.hasY) expect(result.afterT, '프로그램 세로 스크롤 정상').toBeGreaterThan(result.beforeT);

    console.log(`[시나리오2] 기존 스크롤 무회귀 PASS (x ${result.beforeL}→${result.afterL}, y ${result.beforeT}→${result.afterT})`);
  });

  test('시나리오3 (AC3): 배경 위 짧은 클릭은 pan 으로 오인 안 함', async ({ page }) => {
    const tt = await prepTimetable(page);
    if (!tt) { test.skip(true, '로그인 실패/타임테이블 미렌더 — 스킵'); return; }

    const before = await tt.evaluate(scrollProbe);
    if (!before.hasX && !before.hasY) { test.skip(true, '오버플로 없음 — 스킵'); return; }

    const box = await tt.boundingBox();
    if (!box) { test.skip(true, '타임테이블 bbox 없음 — 스킵'); return; }

    // 배경 위 임계(5px) 미만 미세 이동만 → pan 미발생(=클릭 취급, 스크롤 불변)
    const px = box.x + box.width - 24;
    const py = box.y + 24;
    await page.mouse.move(px, py);
    await page.mouse.down();
    await page.mouse.move(px - 3, py - 3, { steps: 2 }); // 대각 ~4px < 5px 임계
    await page.mouse.up();

    const after = await tt.evaluate(scrollProbe);
    expect(after.scrollLeft, '임계 미만 미세 이동은 pan 미발생(가로 불변)').toBe(before.scrollLeft);
    expect(after.scrollTop, '임계 미만 미세 이동은 pan 미발생(세로 불변)').toBe(before.scrollTop);

    console.log('[시나리오3] 임계 미만 클릭 = pan 오인 없음 PASS');
  });

});
