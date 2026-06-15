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
 * AC-3 (target 슬롯 고정 — 콘텐츠 비연동): 조정 대상 4슬롯은 inline height(calc(100vh-200px)) 가
 *        stretch 보다 우선해 콘텐츠 양과 무관하게 동일 고정 높이를 유지한다(서로 끌려가지 않음).
 * AC-4 (bed-grid 컴팩트화 — FIX/gvsl scope-narrow): 치료실·레이저실(bed-grid)은 컨테이너가 기준
 *        높이를 채우되 grid align-content:start 로 bed 셀을 자연 높이(컴팩트)로 상단 정렬한다.
 *        (stretch 면 bed 셀이 비정상적으로 길어짐 — "보기싫다"의 실체. 고정 bed 수 격자라 내부 스크롤 강제 아님.)
 *
 * ── FIX/ys5t 회귀 복원 (배포 c5e8bb7 후 김주연 총괄 확인) ──────────────────────────────
 * AC-R1 (비대상 슬롯 높이 원복): [접수중]·[상담대기] 등 비대상 슬롯은 9340e8d 의 items-start 전역
 *        적용으로 stretch 가 끊겨 자연(짧은) 높이로 줄어드는 회귀가 있었다. 부모 행을 h-full(기본
 *        stretch)로 복원 → 비대상 슬롯이 행 높이(=target 고정 높이)에 다시 stretch 되어 줄어들지 않는다.
 * AC-R3 (높이 통일 CSS 격리 — 누수 0): height 통일은 조정 대상 4슬롯에 per-element inline style 로만
 *        적용된다. 비대상 슬롯 컬럼에는 SLOT_COLUMN_HEIGHT(100vh/200px) inline height 가 선언되지 않는다.
 *        부모 행은 items-start 가 아니라 stretch(기본) 여야 한다(전역 decoupling 누수 제거 가드).
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

  // AC-3: target 슬롯은 inline 고정 높이가 stretch 보다 우선해 콘텐츠 양과 무관하게 동일 높이를 유지한다
  test('AC-3: 슬롯 컨테이너가 콘텐츠 양과 무관하게 고정 높이를 유지한다(target 4슬롯 동일)', async ({ page }) => {
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

  // AC-R3 (누수 가드): 부모 슬롯 행이 items-start 가 아니라 stretch(기본) 여야 한다.
  //   items-start 면 명시 높이 없는 비대상 슬롯의 stretch 가 전역 제거되어 줄어드는 회귀(ys5t) 재발.
  test('AC-R3: 부모 칸반 슬롯 행이 align-items:stretch(기본) 다 — items-start 누수 없음', async ({ page }) => {
    const row = page.getByTestId('kanban-slot-row');
    await expect(row).toBeVisible({ timeout: 8000 });
    const alignItems = await row.evaluate((el) => getComputedStyle(el).alignItems);
    // 'normal'(=기본 stretch) 또는 'stretch' 허용. 'flex-start'/'start'면 비대상 슬롯 stretch 끊김 = FAIL.
    expect(['stretch', 'normal'], 'kanban-slot-row align-items').toContain(alignItems);
  });

  // AC-R3 (누수 가드): 높이 통일 inline style 은 조정 대상 슬롯에만 — 비대상 슬롯 컬럼엔 선언 0
  test('AC-R3: [접수중]·[상담대기] 컬럼에 SLOT_COLUMN_HEIGHT inline height 누수가 없다', async ({ page }) => {
    let checked = 0;
    for (const dropId of ['receiving', 'consult_waiting'] as const) {
      const drop = page.locator(`[data-droppable-id="${dropId}"]`);
      if (await drop.count() === 0) continue; // 슬롯 미렌더 시 스킵
      // 비대상 슬롯 컬럼(= droppable 의 외곽 컬럼 div)에 calc(100vh-200px) inline height 가 없어야 한다.
      // droppable 자신 + 조상 컬럼(w-44 shrink-0) 모두 검사: 어디에도 고정 height 누수 금지.
      const leaked = await drop.first().evaluate((el) => {
        let node: HTMLElement | null = el as HTMLElement;
        for (let i = 0; i < 4 && node; i += 1) {
          const s = node.getAttribute('style') ?? '';
          const compact = s.replace(/\s+/g, '');
          if (/(^|;)height:/.test(compact) && compact.includes('100vh') && compact.includes('200px')) return true;
          node = node.parentElement;
        }
        return false;
      });
      expect(leaked, `${dropId} 컬럼에 height-unify inline 누수`).toBe(false);
      checked += 1;
    }
    test.skip(checked === 0, '비대상 슬롯(접수중/상담대기) 미렌더');
  });

  // AC-R1 (높이 원복): [접수중]·[상담대기] 가 줄어들지 않고 target 슬롯과 동일 높이로 stretch 된다
  test('AC-R1: [접수중]·[상담대기] 슬롯이 target 슬롯 높이로 stretch 되어 줄어들지 않는다', async ({ page }) => {
    const baseEl = page.getByTestId('slot-col-treatment-waiting');
    await expect(baseEl).toBeVisible({ timeout: 8000 });
    const baseBox = await baseEl.first().boundingBox();
    expect(baseBox).not.toBeNull();
    const base = baseBox!.height;
    let checked = 0;
    for (const dropId of ['receiving', 'consult_waiting'] as const) {
      const drop = page.locator(`[data-droppable-id="${dropId}"]`);
      if (await drop.count() === 0) continue;
      // DroppableColumn className="h-full" → 외곽 컬럼(행 높이에 stretch)을 꽉 채움.
      const box = await drop.first().boundingBox();
      if (!box) continue;
      // 회귀 시(items-start)엔 비대상 슬롯이 자연 높이로 줄어 base 대비 현저히 짧아진다.
      // 복원 후엔 행 높이(=base 고정 높이)에 stretch → base 와 근접(헤더/보더 오차 허용).
      expect(box.height, `${dropId} height ${box.height} 가 base ${base} 대비 줄어듦(회귀)`).toBeGreaterThanOrEqual(base - 4);
      checked += 1;
    }
    test.skip(checked === 0, '비대상 슬롯(접수중/상담대기) 미렌더');
  });

  // AC-R1b (REOPEN/qbv1 RC 직접 가드): 부모 칸반 행이 definite min-height 를 가진다.
  //   RC: 부모 zoom 래퍼(inline-block)가 height auto 라 행의 h-full 이 auto 로 붕괴 → stretch 가
  //   비대상 컬럼을 baseline 으로 못 늘림(빈 [상담대기]가 min-h-80px 로 짧아짐). 행에 inline minHeight
  //   (calc(100vh-200px))를 부여해 definite height 확보 → stretch 균일화. computed min-height 가
  //   0/auto 가 아니라 뷰포트 기준 큰 값(>200px)이어야 RC 가 막힌 것.
  test('AC-R1b: 부모 칸반 슬롯 행이 definite min-height(>200px) 를 가진다 — h-full 붕괴 RC 가드', async ({ page }) => {
    const row = page.getByTestId('kanban-slot-row');
    await expect(row).toBeVisible({ timeout: 8000 });
    const minH = await row.evaluate((el) => {
      const v = getComputedStyle(el).minHeight;
      return v === 'auto' || v === 'none' ? 0 : parseFloat(v);
    });
    // calc(100vh - 200px) 는 일반적 뷰포트에서 수백 px. auto(=0) 이면 RC 미해소.
    expect(minH, `kanban-slot-row min-height(${minH}px) 가 definite(>200px) 여야 stretch 균일화`).toBeGreaterThan(200);
  });

  // AC-R1b (대칭 가드): [상담대기] 높이 == [접수중] 높이. 콘텐츠 유무와 무관하게 두 비대상 컬럼이
  //   동일 높이여야 한다(접수중만 카드로 우연히 늘어나고 상담대기는 빈 채로 붕괴한 비대칭 = 본 reopen 결함).
  test('AC-R1b: [상담대기] 컬럼 높이가 [접수중] 컬럼 높이와 동일하다(비대칭 제거)', async ({ page }) => {
    const recv = page.locator('[data-droppable-id="receiving"]');
    const consult = page.locator('[data-droppable-id="consult_waiting"]');
    if (await recv.count() === 0 || await consult.count() === 0) {
      test.skip(true, '접수중/상담대기 슬롯 미렌더');
    }
    const recvBox = await recv.first().boundingBox();
    const consultBox = await consult.first().boundingBox();
    expect(recvBox).not.toBeNull();
    expect(consultBox).not.toBeNull();
    // 두 비대상 컬럼은 동일 행 stretch 로 같은 높이여야 함(서브픽셀/보더 오차 2px 허용).
    expect(
      Math.abs(recvBox!.height - consultBox!.height),
      `상담대기(${consultBox!.height}) != 접수중(${recvBox!.height}) — 비대칭 잔존`,
    ).toBeLessThanOrEqual(2);
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
