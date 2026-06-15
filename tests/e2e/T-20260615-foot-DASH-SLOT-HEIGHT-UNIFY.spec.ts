/**
 * T-20260615-foot-DASH-SLOT-HEIGHT-UNIFY
 * 대시보드 칸반 슬롯 높이 통일 (CSS only)
 *
 * 요청자: 김주연 총괄 — "다 비워져 있을 때 5개 슬롯 세로 사이즈가 동일한 형태"
 *
 * AC-1 (빈 상태 동일 높이): 5개 슬롯(치료대기·치료실·레이저실·수납대기·완료)의 컬럼 컨테이너가
 *        [치료대기] 빈 상태 기준 고정 높이(calc(100vh - 200px))로 묶여, 렌더된 슬롯 컬럼들의 픽셀 높이가 동일하다.
 * AC-2 (콘텐츠 비성장 + 내부 스크롤): 카드(고객박스)가 추가돼도 슬롯 컨테이너는 세로로 성장하지 않고
 *        내부 overflow-y:auto 로 처리된다. (슬롯 본문에 세로 오버플로 스크롤 보장)
 * AC-3 (슬롯 독립 — 형제 stretch 연동 제거): 부모 flex 행이 items-start 라 형제 슬롯 높이가
 *        서로 끌려가지 않는다. 한 슬롯 콘텐츠가 많아도 다른 슬롯 높이에 영향 없음(고정값 유지).
 * AC-4 (bed-grid 컴팩트화 — FIX/gvsl scope-narrow): 치료실·레이저실(bed-grid)은 컨테이너가 기준
 *        높이를 채우되 grid align-content:start 로 bed 셀을 자연 높이(컴팩트)로 상단 정렬한다.
 *        (stretch 면 bed 셀이 비정상적으로 길어짐 — "보기싫다"의 실체. 고정 bed 수 격자라 내부 스크롤 강제 아님.)
 *
 * Scope 한정 (MSG-k63x 4차 명확화): 조정 대상 = 치료실·레이저실·수납대기+완료 3타입.
 *   기준 슬롯 = [치료대기](불변). gvsl: bed-grid는 컴팩트화 허용(내부 스크롤 강제 아님).
 *
 * 구현 SSOT: src/pages/Dashboard.tsx — const SLOT_COLUMN_HEIGHT = 'calc(100vh - 200px)'
 *   slot-col-* data-testid 4종(treatment-waiting / treatment-rooms / desk / laser-rooms).
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

// 슬롯 컬럼 testid (렌더 조건에 따라 일부는 부재할 수 있음 — 치료실/레이저실은 방 0개면 미렌더)
const SLOT_COLS = [
  'slot-col-treatment-waiting', // 치료대기 (기준 슬롯)
  'slot-col-treatment-rooms',   // 치료실
  'slot-col-laser-rooms',       // 레이저실
  'slot-col-desk',              // 수납대기 + 완료
] as const;

async function loginIfNeeded(page: import('@playwright/test').Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? 'testpass');
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|$)/, { timeout: 10000 });
  }
}

test.describe('T-20260615-foot-DASH-SLOT-HEIGHT-UNIFY', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');
    // 기준 슬롯(치료대기)이 렌더될 때까지 대기 — 칸반 영역 마운트 보장
    await page.getByTestId('slot-col-treatment-waiting').waitFor({ timeout: 10000 });
  });

  // AC-1: 렌더된 모든 슬롯 컬럼이 동일한 고정 height 인라인 스타일을 가진다 (빈/내용 무관 결정적)
  test('AC-1: 슬롯 컬럼들이 동일한 고정 height(calc(100vh - 200px)) 스타일을 가진다', async ({ page }) => {
    let present = 0;
    for (const tid of SLOT_COLS) {
      const el = page.getByTestId(tid);
      if (await el.count() === 0) continue; // 방 0개 등으로 미렌더된 슬롯은 스킵
      present += 1;
      // 브라우저 CSSOM이 calc 를 정규화(예: 'calc(-200px + 100vh)')하므로 토큰 단위로 검증.
      const styleAttr = ((await el.first().getAttribute('style')) ?? '').replace(/\s+/g, '');
      // 1) height(=고정) 선언이 존재하고 min-height 가 아니다 → 콘텐츠로 성장 불가
      expect(/(^|;)height:/.test(styleAttr), `${tid} has fixed height decl`).toBe(true);
      // 2) 값이 뷰포트(100vh)에서 상단 영역(200px)을 뺀 calc 기준값이다
      expect(styleAttr).toContain('100vh');
      expect(styleAttr).toContain('200px');
    }
    // 최소 기준 슬롯 + 1개 이상은 렌더돼야 비교 의미가 있음
    expect(present).toBeGreaterThanOrEqual(2);
  });

  // AC-1: 렌더된 슬롯 컬럼들의 실제 픽셀 높이가 서로 동일하다 (빈 상태 기준 통일)
  test('AC-1: 렌더된 슬롯 컬럼들의 렌더 픽셀 높이가 픽셀 단위로 동일하다', async ({ page }) => {
    const heights: { tid: string; h: number }[] = [];
    for (const tid of SLOT_COLS) {
      const el = page.getByTestId(tid);
      if (await el.count() === 0) continue;
      const box = await el.first().boundingBox();
      if (box) heights.push({ tid, h: box.height });
    }
    expect(heights.length).toBeGreaterThanOrEqual(2);
    const base = heights[0].h;
    for (const { tid, h } of heights) {
      // 동일 calc + 동일 zoom scale → 렌더 높이 동일. 서브픽셀 반올림 1px 허용.
      expect(Math.abs(h - base), `${tid} height ${h} != base ${base}`).toBeLessThanOrEqual(1);
    }
  });

  // AC-2: 치료대기 슬롯 본문이 내부 세로 스크롤(overflow-y:auto)을 가진다 — 콘텐츠 초과 시 컨테이너 비성장
  test('AC-2: 슬롯 본문이 overflow-y auto/scroll 로 내부 스크롤 처리한다', async ({ page }) => {
    // DroppableColumn 본문: data-droppable-id 슬롯 내부 스크롤 영역
    const col = page.locator('[data-droppable-id="treatment_waiting"]');
    await expect(col).toBeVisible({ timeout: 8000 });
    // 본문 스크롤 컨테이너 = 마지막 자식(flex-1 overflow-y-auto)
    const body = col.locator('> div').last();
    const overflowY = await body.evaluate((el) => getComputedStyle(el).overflowY);
    expect(['auto', 'scroll']).toContain(overflowY);
  });

  // AC-2: 수납대기 슬롯도 내부 스크롤 — 카드 누적되는 데스크 컬럼이 세로로 성장하지 않도록
  test('AC-2: 수납대기 슬롯 본문도 overflow-y auto/scroll 로 내부 스크롤한다', async ({ page }) => {
    const col = page.locator('[data-droppable-id="payment_waiting"]');
    if (await col.count() === 0) test.skip(true, 'payment_waiting 미렌더');
    await expect(col.first()).toBeVisible({ timeout: 8000 });
    const body = col.first().locator('> div').last();
    const overflowY = await body.evaluate((el) => getComputedStyle(el).overflowY);
    expect(['auto', 'scroll']).toContain(overflowY);
  });

  // AC-3: 부모 슬롯 행이 items-start 라 형제 슬롯 높이가 서로 stretch 연동되지 않는다
  test('AC-3: 슬롯 컨테이너가 콘텐츠 양과 무관하게 고정 높이를 유지한다(형제 연동 없음)', async ({ page }) => {
    // 슬롯 본문(scroll 영역)에 카드가 있는 슬롯과 없는 슬롯이 섞여 있어도 컬럼 높이는 동일해야 한다.
    // → 실제 데이터 유무와 무관하게 컬럼 높이 동일성으로 "형제 비연동 + 고정"을 검증.
    const measured: number[] = [];
    for (const tid of SLOT_COLS) {
      const el = page.getByTestId(tid);
      if (await el.count() === 0) continue;
      const box = await el.first().boundingBox();
      if (box) measured.push(box.height);
    }
    expect(measured.length).toBeGreaterThanOrEqual(2);
    const max = Math.max(...measured);
    const min = Math.min(...measured);
    // 카드가 많은 슬롯이 다른 슬롯을 끌어올리거나 자기만 길어지면 max-min 차이가 발생.
    expect(max - min).toBeLessThanOrEqual(1);
  });

  // AC-4: bed-grid(치료실/레이저실) 그리드가 align-content:start 로 bed 셀을 컴팩트 상단 정렬한다
  //       (stretch 면 auto 행이 늘어나 bed 셀이 비정상적으로 길어짐 — gvsl 격자 컴팩트화 핀포인트)
  test('AC-4: 치료실/레이저실 bed-grid 가 content-start(align-content:start)로 컴팩트 정렬한다', async ({ page }) => {
    let checked = 0;
    for (const tid of ['slot-col-treatment-rooms', 'slot-col-laser-rooms'] as const) {
      const col = page.getByTestId(tid);
      if (await col.count() === 0) continue; // 방 0개면 미렌더 → 스킵
      // fillHeight 그리드 = 컬럼 내부 grid display + overflow-y auto 컨테이너
      const grid = col.first().locator('.grid').last();
      if (await grid.count() === 0) continue;
      const alignContent = await grid.first().evaluate((el) => getComputedStyle(el).alignContent);
      // 'start' / 'flex-start' 둘 다 허용(브라우저 정규화). 'stretch'/'normal'이면 셀이 늘어나 FAIL.
      expect(['start', 'flex-start'], `${tid} align-content`).toContain(alignContent);
      checked += 1;
    }
    test.skip(checked === 0, 'bed-grid 슬롯 미렌더(방 0개)');
  });

  // 회귀: 칸반 슬롯 영역이 콘솔 오류 없이 정상 렌더된다
  test('회귀: 슬롯 높이 통일 적용 후 대시보드가 콘솔 오류 없이 렌더된다', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('slot-col-treatment-waiting')).toBeVisible({ timeout: 8000 });
    const layoutErrors = errors.filter((e) => /height|flex|overflow|render/i.test(e));
    expect(layoutErrors).toHaveLength(0);
  });
});
