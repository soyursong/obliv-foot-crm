/**
 * T-20260615-foot-DASH-SLOT-HEIGHT-UNIFY  (REVERSAL 2026-06-17, scope② 4슬롯 통일)
 * 대시보드 칸반 슬롯 높이 — 빈 상태 baseline 통일 + 카드 추가 시 자연 성장 (CSS only)
 *
 * 요청자: 김주연 총괄 (U0ATDB587PV)
 *   원의도 재명시(ts 1781673452/1781673762): "빈 상태 동일 + 수납대기 고객 늘면 칸 자동으로 늘려줘
 *   (고정값 아님, 내부 스크롤 아님) → 4개 슬롯 전체 통일."
 *   ⚠ 기존 §AC(고정 height·내부 스크롤·성장 금지)는 정반대 → SUPERSEDED. 본 spec 이 신 스펙 가드.
 *
 * 신 AC (기존 AC-1/AC-2/AC-3 "고정·성장금지·내부스크롤" 가드는 폐기/전환):
 *  AC-NEW-1 (빈 상태 baseline 통일): 타깃 4슬롯(치료실·레이저실·수납대기+완료)의 컬럼 컨테이너가
 *     min-height: SLOT_COLUMN_HEIGHT(420px, [상담대기] 기준) floor 를 가져, 빈 상태에서 세로 사이즈가 동일하다.
 *  AC-NEW-1b (REVERSAL 가드): 타깃 슬롯은 고정 height 가 아니라 min-height 를 쓴다 → 콘텐츠로 성장 가능.
 *  AC-NEW-2 (자연 성장 — 내부 스크롤 제거): 수납대기·완료 컬럼 본문은 overflow-y:visible(내부 스크롤 X) →
 *     카드 누적 시 슬롯 칸 자체가 세로로 성장(보드 외곽 스크롤로 처리).
 *  AC-NEW-3 (bed-grid 통일+성장): 치료실·레이저실(bed-grid)도 min-height baseline + content-start 컴팩트.
 *  AC-NEW-4 (형제 비연동 독립 성장): 부모 칸반 행 align-items:flex-start(items-start) → 한 슬롯 성장이
 *     형제를 끌어올리지 않는다. (과거 stretch = 형제 연동 오염의 원인 → REVERSAL)
 *
 * 회귀 가드(유지):
 *  AC-R1 (비대상 슬롯 동작 불변): [접수중]·[상담대기] 등 비대상 컬럼은 min-height floor 로 baseline 유지
 *     (붕괴 0) + 본문 overflow-y:auto 내부 스크롤 유지(타깃과 달리 자연 성장 안 함 = 동작 불변).
 *
 * 구현 SSOT: src/pages/Dashboard.tsx
 *   const SLOT_COLUMN_HEIGHT = '420px' (min-height baseline)
 *   DroppableColumn { style?, naturalGrow? } / kanban-slot-row items-start
 *   slot-col-* data-testid 4종(treatment-waiting / treatment-rooms / desk / laser-rooms).
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';
const BASELINE = 420; // SLOT_COLUMN_HEIGHT px

// 타깃 슬롯 컬럼 testid (방 0개면 치료실/레이저실 미렌더 → 스킵)
const TARGET_SLOT_COLS = [
  'slot-col-treatment-rooms', // 치료실 (bed-grid)
  'slot-col-laser-rooms',     // 레이저실 (bed-grid)
  'slot-col-desk',            // 수납대기 + 완료 (칸반, 핵심 성장 슬롯)
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

// 엘리먼트의 computed min-height(px) 추출
async function minHeightPx(loc: import('@playwright/test').Locator): Promise<number> {
  return loc.first().evaluate((el) => {
    const v = getComputedStyle(el as HTMLElement).minHeight;
    return v === 'auto' || v === 'none' ? 0 : parseFloat(v);
  });
}

test.describe('T-20260615-foot-DASH-SLOT-HEIGHT-UNIFY (REVERSAL)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');
    await page.getByTestId('slot-col-treatment-waiting').waitFor({ timeout: 10000 });
  });

  // AC-NEW-1: 타깃 슬롯 컬럼이 동일한 min-height baseline(420px) floor 를 가진다 (콘텐츠 무관 결정적)
  test('AC-NEW-1: 타깃 슬롯이 동일 min-height baseline(420px) floor 를 가진다', async ({ page }) => {
    let present = 0;
    for (const tid of TARGET_SLOT_COLS) {
      const el = page.getByTestId(tid);
      if (await el.count() === 0) continue;
      present += 1;
      const minH = await minHeightPx(el);
      // baseline floor 가 420px 로 통일 — 빈 상태 세로 동일 보장. (1px 서브픽셀 허용)
      expect(Math.abs(minH - BASELINE), `${tid} min-height ${minH} != ${BASELINE}`).toBeLessThanOrEqual(1);
    }
    expect(present).toBeGreaterThanOrEqual(1);
  });

  // AC-NEW-1b (REVERSAL 가드): 타깃 슬롯은 고정 height 가 아니라 min-height 를 쓴다 → 성장 가능
  test('AC-NEW-1b: 타깃 슬롯이 고정 height 가 아닌 min-height 를 쓴다(성장 허용)', async ({ page }) => {
    let checked = 0;
    for (const tid of TARGET_SLOT_COLS) {
      const el = page.getByTestId(tid);
      if (await el.count() === 0) continue;
      const styleAttr = ((await el.first().getAttribute('style')) ?? '').replace(/\s+/g, '');
      // min-height 선언 존재 + 고정 height 선언 부재(과거 고정 height 회귀 가드).
      expect(/(^|;)min-height:/.test(styleAttr), `${tid} has min-height`).toBe(true);
      expect(/(^|;)height:/.test(styleAttr), `${tid} 고정 height 잔존 금지`).toBe(false);
      checked += 1;
    }
    expect(checked).toBeGreaterThanOrEqual(1);
  });

  // AC-NEW-2: 수납대기·완료 컬럼 본문이 내부 스크롤(overflow-y:auto/scroll)이 아니다 → 자연 성장
  test('AC-NEW-2: 수납대기·완료 본문이 내부 스크롤 없이 자연 성장한다(overflow-y visible)', async ({ page }) => {
    let checked = 0;
    for (const dropId of ['payment_waiting', 'done'] as const) {
      const col = page.locator(`[data-droppable-id="${dropId}"]`);
      if (await col.count() === 0) continue;
      await expect(col.first()).toBeVisible({ timeout: 8000 });
      const body = col.first().locator('> div').last();
      const overflowY = await body.evaluate((el) => getComputedStyle(el as HTMLElement).overflowY);
      // naturalGrow → 본문 overflow-y 캡 제거. auto/scroll 이면 카드 추가 시 슬롯이 안 커지는 회귀.
      expect(overflowY, `${dropId} 본문 overflow-y(${overflowY}) 가 내부 스크롤이면 자연 성장 불가`).toBe('visible');
      checked += 1;
    }
    test.skip(checked === 0, '수납대기/완료 슬롯 미렌더');
  });

  // AC-NEW-3: bed-grid(치료실/레이저실) 가 min-height baseline + content-start 컴팩트 정렬
  test('AC-NEW-3: 치료실/레이저실 bed-grid 가 baseline floor + content-start 컴팩트 정렬', async ({ page }) => {
    let checked = 0;
    for (const tid of ['slot-col-treatment-rooms', 'slot-col-laser-rooms'] as const) {
      const col = page.getByTestId(tid);
      if (await col.count() === 0) continue;
      // baseline floor
      const minH = await minHeightPx(col);
      expect(Math.abs(minH - BASELINE), `${tid} min-height ${minH}`).toBeLessThanOrEqual(1);
      // content-start 컴팩트(셀 stretch 금지)
      const grid = col.first().locator('.grid').last();
      if (await grid.count() === 0) continue;
      const alignContent = await grid.first().evaluate((el) => getComputedStyle(el as HTMLElement).alignContent);
      expect(['start', 'flex-start'], `${tid} align-content`).toContain(alignContent);
      checked += 1;
    }
    test.skip(checked === 0, 'bed-grid 슬롯 미렌더(방 0개)');
  });

  // AC-NEW-4 (REVERSAL): 부모 칸반 행이 items-start(flex-start) → 형제 비연동 독립 성장
  test('AC-NEW-4: 부모 칸반 슬롯 행이 align-items:flex-start(items-start) 다 — 형제 비연동', async ({ page }) => {
    const row = page.getByTestId('kanban-slot-row');
    await expect(row).toBeVisible({ timeout: 8000 });
    const alignItems = await row.evaluate((el) => getComputedStyle(el as HTMLElement).alignItems);
    // 'flex-start'/'start' 여야 한 슬롯 성장이 형제 stretch 로 전파되지 않는다.
    // 'stretch'/'normal'이면 과거 형제 연동 오염 = FAIL(REVERSAL 미적용).
    expect(['flex-start', 'start'], 'kanban-slot-row align-items').toContain(alignItems);
  });

  // AC-R1 (동작 불변): [접수중]·[상담대기] 비대상 컬럼이 min-height floor(붕괴 0) + 내부 스크롤 유지
  test('AC-R1: [접수중]·[상담대기] 가 baseline floor 유지 + 내부 스크롤(동작 불변)', async ({ page }) => {
    let checked = 0;
    for (const dropId of ['receiving', 'consult_waiting'] as const) {
      const drop = page.locator(`[data-droppable-id="${dropId}"]`);
      if (await drop.count() === 0) continue;
      // 1) floor 유지 — items-start 전환 후에도 붕괴하지 않고 baseline(420) 확보
      const minH = await minHeightPx(drop);
      expect(Math.abs(minH - BASELINE), `${dropId} min-height ${minH} != ${BASELINE}(붕괴/누락)`).toBeLessThanOrEqual(1);
      // 2) 본문 내부 스크롤 유지 — 타깃과 달리 자연 성장 안 함(동작 불변)
      const body = drop.first().locator('> div').last();
      const overflowY = await body.evaluate((el) => getComputedStyle(el as HTMLElement).overflowY);
      expect(['auto', 'scroll'], `${dropId} 본문 overflow-y(${overflowY}) 내부 스크롤 유지`).toContain(overflowY);
      // 3) boundingBox 가 floor 이상 (현장 렌더 확인)
      const box = await drop.first().boundingBox();
      if (box) expect(box.height, `${dropId} 렌더 높이 ${box.height}`).toBeGreaterThanOrEqual(BASELINE - 4);
      checked += 1;
    }
    test.skip(checked === 0, '비대상 슬롯(접수중/상담대기) 미렌더');
  });

  // 회귀: 슬롯 높이 reversal 적용 후 대시보드가 콘솔 오류 없이 렌더된다
  test('회귀: reversal 적용 후 대시보드가 콘솔 오류 없이 렌더된다', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('slot-col-treatment-waiting')).toBeVisible({ timeout: 8000 });
    const layoutErrors = errors.filter((e) => /height|flex|overflow|render/i.test(e));
    expect(layoutErrors).toHaveLength(0);
  });
});
