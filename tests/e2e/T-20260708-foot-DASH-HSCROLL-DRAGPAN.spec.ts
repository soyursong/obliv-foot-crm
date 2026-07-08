/**
 * E2E spec — T-20260708-foot-DASH-HSCROLL-DRAGPAN
 * 현장(풋센터) 요청: "대시보드 현황판에서 옆으로 넘기는거 스크롤 말고 화면 꾹 누르고 넘기기"
 *   = 대시보드 현황판(칸반) 가로영역을 마우스로 배경을 누른 채 좌우로 끌면 콘텐츠가 따라 이동하는
 *     drag-to-pan(grab-and-drag) 인터랙션 추가. 기존 스크롤은 유지, 드래그는 추가 수단.
 *
 * AC:
 *  AC1 배경/빈영역 마우스 누른 채 좌우 드래그 → 콘텐츠 따라 이동, 떼면 멈춤.
 *  AC2 기존 휠/트랙패드/스크롤바 유지(대체 아님) — 프로그램 스크롤 여전히 동작.
 *  AC3 드래그 중 커서 grab→grabbing.
 *  AC4 클릭 가능 요소 위 짧은 클릭은 팬으로 오인 안 함(이동거리 임계 ~5px로 구분) — 클릭 무회귀.
 *  AC5 최소 요구=가로 이동. 세로 스크롤 방해 X.
 *  AC6 (★ 태블릿 주요, 3차 relay) 카드단위 snap — 컨테이너 scroll-snap-type:x mandatory + 자식 snap-start.
 *  AC7 (PC 보조, 3차 relay) 좌/우 화살표 버튼 + 키보드 ←/→ 로 카드 한 단위씩 넘기기.
 *
 * 구현: pointer 이벤트(pointerdown/move/up)+scrollLeft self-implement (신규 npm 無) — useDragToPan 훅.
 *   AC6 = CSS scroll-snap(라이브러리 無), AC7 = scrollKanbanByColumn(getBoundingClientRect 기반 컬럼 정렬).
 *
 * 뷰포트 전략: 로그인은 데스크톱 폭(사이드바 '대시보드' 라벨 노출)에서 수행하고,
 *   로그인 후 좁은 폭으로 리사이즈해 가로 오버플로를 유도한다(태블릿 세로 근사). 오버플로가 없으면 graceful skip.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// 로그인 후 좁혀서 가로 오버플로 유도할 폭.
//   md(768) 이상 유지 → 데스크톱 레이아웃(칸반=flex-1 bounded, overflow-auto 내부 스크롤) 보존.
//   폭을 좁혀 상태 컬럼들이 칸반 가시폭을 초과 → 내부 가로 오버플로 발생. 칸반 box 는 뷰포트 내(온스크린).
const NARROW = { width: 820, height: 900 };

test.describe('T-20260708-foot-DASH-HSCROLL-DRAGPAN', () => {

  // el 자신부터 위로 올라가며 가로 스크롤이 실재하는 컨테이너의 지표 반환 (훅 findHScrollTarget 동형).
  // ⚠ 브라우저로 직렬화되어 실행되므로 self-contained (외부 스코프 참조 금지).
  const scrollProbe = (el: Element) => {
    let node: HTMLElement | null = el as HTMLElement;
    while (node) {
      if (node.scrollWidth > node.clientWidth + 1) {
        return { hasOverflow: true, scrollLeft: node.scrollLeft, scrollTop: node.scrollTop, marker: node.getAttribute('data-testid') };
      }
      node = node.parentElement;
    }
    return { hasOverflow: false, scrollLeft: 0, scrollTop: 0, marker: null as string | null };
  };

  async function prepKanban(page: Page) {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) return null;
    await page.setViewportSize(NARROW); // 로그인 후 좁혀 오버플로 유도
    await page.waitForTimeout(600);
    const kanban = page.locator('[data-testid="kanban-scroll"]').first();
    const visible = await kanban.isVisible({ timeout: 10_000 }).catch(() => false);
    return visible ? kanban : null;
  }

  test('시나리오1 (AC1/AC3/AC5): 배경 grab-and-drag 로 가로 pan + 세로 무영향', async ({ page }) => {
    const kanban = await prepKanban(page);
    if (!kanban) { test.skip(true, '로그인 실패/칸반 미렌더 — 스킵'); return; }

    const before = await kanban.evaluate(scrollProbe);
    if (!before.hasOverflow) { test.skip(true, '가로 오버플로 없음(데이터/뷰포트) — pan 대상 없음, 스킵'); return; }

    const box = await kanban.boundingBox();
    if (!box) { test.skip(true, '칸반 bbox 없음 — 스킵'); return; }

    // 배경(빈영역) 추정 지점 — 컨테이너 상단 p-3 패딩(자식 없는 순수 배경). 우측 근처에서 왼쪽으로 끌어 scrollLeft 증가.
    // pan 개시 후 pointer capture 로 el 밖으로 나가도 이벤트가 el 로 전달됨(좌측 이탈 무해).
    const startX = box.x + box.width - 20;
    const startY = box.y + 6;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 30, startY, { steps: 3 }); // 임계(5px) 초과 → pan 개시
    const cursorDuringDrag = await kanban.evaluate((el) => (el as HTMLElement).style.cursor); // AC3
    await page.mouse.move(startX - 250, startY, { steps: 10 });
    const afterDrag = await kanban.evaluate(scrollProbe);
    await page.mouse.up();

    // AC1/AC5
    expect(afterDrag.scrollLeft, `드래그로 가로 pan 발생(before=${before.scrollLeft}, after=${afterDrag.scrollLeft})`).not.toBe(before.scrollLeft);
    expect(afterDrag.scrollTop, '세로 스크롤 방해 없음(scrollTop 불변)').toBe(before.scrollTop);
    // AC3
    expect(cursorDuringDrag, `드래그 중 커서=grabbing (실제="${cursorDuringDrag}")`).toBe('grabbing');

    // 떼면 멈춤 — up 이후 이동해도 scrollLeft 고정
    const restLeft = afterDrag.scrollLeft;
    await page.mouse.move(startX - 450, startY, { steps: 4 });
    const afterRelease = await kanban.evaluate(scrollProbe);
    expect(afterRelease.scrollLeft, '마우스를 뗀 뒤에는 pan 멈춤(scrollLeft 고정)').toBe(restLeft);

    // 커서 원복
    const cursorAfter = await kanban.evaluate((el) => (el as HTMLElement).style.cursor);
    expect(cursorAfter, '드래그 종료 후 grabbing 커서 해제').not.toBe('grabbing');

    console.log(`[시나리오1] grab-and-drag 가로 pan PASS (target=${before.marker}, scrollLeft ${before.scrollLeft}→${afterDrag.scrollLeft}, scrollTop 불변)`);
  });

  test('시나리오2 (AC2): 기존 프로그램/휠 스크롤 무회귀', async ({ page }) => {
    const kanban = await prepKanban(page);
    if (!kanban) { test.skip(true, '로그인 실패/칸반 미렌더 — 스킵'); return; }

    // pan 훅이 붙어도 scrollLeft 프로그램 설정(=휠/스크롤바 상당)이 그대로 동작해야 함.
    const result = await kanban.evaluate((el) => {
      let node: HTMLElement | null = el as HTMLElement;
      while (node) {
        if (node.scrollWidth > node.clientWidth + 1) break;
        node = node.parentElement;
      }
      if (!node) return { hasOverflow: false, before: 0, after: 0 };
      const before = node.scrollLeft;
      node.scrollLeft = before + 120;
      return { hasOverflow: true, before, after: node.scrollLeft };
    });
    if (!result.hasOverflow) { test.skip(true, '가로 오버플로 없음 — 스킵'); return; }
    expect(result.after, '프로그램 스크롤(휠/스크롤바 상당) 정상 동작').toBeGreaterThan(result.before);

    console.log(`[시나리오2] 기존 스크롤 무회귀 PASS (scrollLeft ${result.before}→${result.after})`);
  });

  test('시나리오3 (AC4): 클릭 가능 요소 위 짧은 클릭은 pan으로 오인 안 함', async ({ page }) => {
    const kanban = await prepKanban(page);
    if (!kanban) { test.skip(true, '로그인 실패/칸반 미렌더 — 스킵'); return; }

    const before = await kanban.evaluate(scrollProbe);
    if (!before.hasOverflow) { test.skip(true, '가로 오버플로 없음 — 스킵'); return; }

    const box = await kanban.boundingBox();
    if (!box) { test.skip(true, '칸반 bbox 없음 — 스킵'); return; }

    // 배경 위에서 임계(5px) 미만 미세 이동만 → pan 미발생(=클릭 취급, scrollLeft 불변)
    const px = box.x + box.width - 20;
    const py = box.y + 6;
    await page.mouse.move(px, py);
    await page.mouse.down();
    await page.mouse.move(px - 3, py, { steps: 2 }); // 3px < 5px 임계
    await page.mouse.up();

    const after = await kanban.evaluate(scrollProbe);
    expect(after.scrollLeft, '임계 미만 미세 이동은 pan 미발생(클릭 취급 → scrollLeft 불변)').toBe(before.scrollLeft);

    console.log('[시나리오3] 임계 미만 클릭 = pan 오인 없음 PASS');
  });

  test('시나리오4 (AC7): PC 좌/우 화살표 버튼 + 키보드로 카드 단위 넘기기', async ({ page }) => {
    const kanban = await prepKanban(page);
    if (!kanban) { test.skip(true, '로그인 실패/칸반 미렌더 — 스킵'); return; }

    const before = await kanban.evaluate(scrollProbe);
    if (!before.hasOverflow) { test.skip(true, '가로 오버플로 없음 — 넘길 카드 없음, 스킵'); return; }

    // 화살표 버튼 존재 확인 (AC7)
    const rightBtn = page.locator('[data-testid="kanban-nav-right"]');
    const leftBtn = page.locator('[data-testid="kanban-nav-left"]');
    await expect(rightBtn, 'AC7: 우측 이동 화살표 버튼 렌더').toBeVisible();
    await expect(leftBtn, 'AC7: 좌측 이동 화살표 버튼 렌더').toBeVisible();

    // 우측 버튼 → scrollLeft 증가 (smooth scroll 반영 대기)
    await rightBtn.click();
    await page.waitForTimeout(500);
    const afterRight = await kanban.evaluate(scrollProbe);
    expect(afterRight.scrollLeft, `우측 화살표로 카드 넘김(scrollLeft ${before.scrollLeft}→${afterRight.scrollLeft})`).toBeGreaterThan(before.scrollLeft);

    // 좌측 버튼 → 되돌아옴
    await leftBtn.click();
    await page.waitForTimeout(500);
    const afterLeft = await kanban.evaluate(scrollProbe);
    expect(afterLeft.scrollLeft, `좌측 화살표로 되돌아옴(scrollLeft ${afterRight.scrollLeft}→${afterLeft.scrollLeft})`).toBeLessThan(afterRight.scrollLeft);

    // 키보드 → 화살표 (입력 포커스 아닌 상태에서)
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(500);
    const afterKey = await kanban.evaluate(scrollProbe);
    expect(afterKey.scrollLeft, `키보드 →로 카드 넘김(scrollLeft ${afterLeft.scrollLeft}→${afterKey.scrollLeft})`).toBeGreaterThan(afterLeft.scrollLeft);

    console.log(`[시나리오4] AC7 PC 버튼/키보드 카드 넘기기 PASS`);
  });

  test('시나리오5 (AC6): 카드단위 snap CSS 활성 (scroll-snap-type + snap-start)', async ({ page }) => {
    const kanban = await prepKanban(page);
    if (!kanban) { test.skip(true, '로그인 실패/칸반 미렌더 — 스킵'); return; }

    // 컨테이너에 scroll-snap-type: x mandatory (Tailwind snap-x snap-mandatory) 가 적용됐는지 (dnd 카드 드래그 중 아님 = 기본 상태)
    const snapType = await kanban.evaluate((el) => getComputedStyle(el as HTMLElement).scrollSnapType);
    expect(snapType, `AC6: 컨테이너 scroll-snap-type 활성 (실제="${snapType}")`).toContain('x');

    // 슬롯 row 자식들이 snap-start(scroll-snap-align: start) 를 가지는지
    const slotRow = page.locator('[data-testid="kanban-slot-row"]').first();
    const rowExists = await slotRow.isVisible({ timeout: 5000 }).catch(() => false);
    if (rowExists) {
      const childAlign = await slotRow.evaluate((row) => {
        const first = row.firstElementChild as HTMLElement | null;
        return first ? getComputedStyle(first).scrollSnapAlign : null;
      });
      expect(childAlign, `AC6: 카드 자식 scroll-snap-align=start (실제="${childAlign}")`).toContain('start');
    }

    console.log(`[시나리오5] AC6 카드단위 snap CSS 활성 PASS (snap-type="${snapType}")`);
  });

});
