/**
 * T-20260622-foot-DASH-PAYMENT-WAITING-EMPTY-HEIGHT  (CSS only)
 * 대시보드 수납대기(payment_waiting) 빈 상태 과성장 회귀 수정.
 *
 * 회귀 정본: T-20260615-foot-DASH-SLOT-HEIGHT-UNIFY / commit e2e3dfe9
 * RC: T-20260620-foot-DASH-DONESLOT-NAMECHIP-COMPACT 에서 수납대기 wrapper minHeight 를
 *     scoped override(PAYMENT_WAITING_COLUMN_HEIGHT = max(560px, calc(100vh-170px)))로 키웠고,
 *     이 floor 가 빈 상태(카드 0)에서도 적용돼 done/laser(420px floor) 보다 과성장.
 *     → 수납대기 wrapper 를 SLOT_COLUMN_HEIGHT(420px) 로 통일 복귀 (naturalGrow 는 유지).
 *
 * AC:
 *  AC-1 (빈 상태 baseline 통일): 수납대기(slot-col-desk) min-height == 완료(slot-col-done)·
 *       레이저실(slot-col-laser-rooms) 동일 baseline(420px). 과성장 없음.
 *  AC-2 (자연 성장 유지): 수납대기 컬럼 본문은 overflow-y:visible(내부 스크롤 아님) → naturalGrow 회귀 금지.
 *  AC-3 (타슬롯 불변): 다른 슬롯 min-height floor 동일(420px) 유지.
 *  AC-4 (콘솔 에러 0).
 *
 * 구현 SSOT: src/pages/Dashboard.tsx
 *   desk_section wrapper style minHeight: PAYMENT_WAITING_COLUMN_HEIGHT → SLOT_COLUMN_HEIGHT(420px)
 *   payment_waiting DroppableColumn naturalGrow (본문 overflow-y-auto/max-h 캡 제거) 유지.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';
const BASELINE = 420; // SLOT_COLUMN_HEIGHT px

async function loginIfNeeded(page: import('@playwright/test').Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })());
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|$)/, { timeout: 10000 });
  }
}

async function minHeightPx(loc: import('@playwright/test').Locator): Promise<number> {
  return loc.first().evaluate((el) => {
    const v = getComputedStyle(el as HTMLElement).minHeight;
    return v === 'auto' || v === 'none' ? 0 : parseFloat(v);
  });
}

test.describe('T-20260622-foot-DASH-PAYMENT-WAITING-EMPTY-HEIGHT', () => {
  const consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => consoleErrors.push(err.message));
    await page.goto(BASE_URL);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');
    await page.getByTestId('slot-col-desk').waitFor({ timeout: 10000 });
  });

  // AC-1: 수납대기 wrapper min-height floor == 420 baseline (빈 상태에서도 과성장 없음, 결정적)
  test('AC-1: 수납대기 min-height baseline(420px) — done/laser 동일, 과성장 없음', async ({ page }) => {
    const deskMinH = await minHeightPx(page.getByTestId('slot-col-desk'));
    expect(Math.abs(deskMinH - BASELINE), `slot-col-desk min-height ${deskMinH} != ${BASELINE}`).toBeLessThanOrEqual(1);
    // 회귀 가드: 옛 override(560px+) floor 가 남아있지 않음
    expect(deskMinH, `수납대기 floor 가 ${deskMinH}px — 과성장 회귀(560px override 잔존)`).toBeLessThan(500);

    // done 컬럼이 존재하면 동일 baseline 확인
    const done = page.getByTestId('slot-col-done');
    if (await done.count() > 0) {
      const doneMinH = await minHeightPx(done);
      expect(Math.abs(deskMinH - doneMinH), `desk(${deskMinH}) != done(${doneMinH})`).toBeLessThanOrEqual(1);
    }
    // laser 컬럼이 존재(방 1개 이상)하면 동일 baseline 확인
    const laser = page.getByTestId('slot-col-laser-rooms');
    if (await laser.count() > 0) {
      const laserMinH = await minHeightPx(laser);
      expect(Math.abs(deskMinH - laserMinH), `desk(${deskMinH}) != laser(${laserMinH})`).toBeLessThanOrEqual(1);
    }
  });

  // AC-2: 수납대기 컬럼 본문은 naturalGrow → 내부 스크롤(overflow-y auto/scroll) 아님 (자연 성장 유지)
  test('AC-2: 수납대기 naturalGrow 유지 — 본문 내부 스크롤 아님', async ({ page }) => {
    const col = page.locator('[data-droppable-id="payment_waiting"]');
    await expect(col).toBeVisible();
    // DroppableColumn 본문(2번째 child div) overflow-y 확인
    const overflowY = await col.evaluate((el) => {
      const body = el.querySelector(':scope > div:nth-child(2)') as HTMLElement | null;
      return body ? getComputedStyle(body).overflowY : 'NOBODY';
    });
    expect(['visible', 'NOBODY']).toContain(overflowY); // naturalGrow=true → overflow-y-auto/max-h 캡 없음
    expect(overflowY).not.toBe('auto');
    expect(overflowY).not.toBe('scroll');
  });

  // AC-3: 다른 슬롯 baseline floor 불변.
  //   floor 부착 위치 2종: (a) 방 섹션 wrapper testid 자체(치료실·레이저실), (b) 칸반 컬럼 DroppableColumn root(치료대기).
  test('AC-3: 타슬롯 min-height baseline(420px) 불변', async ({ page }) => {
    // (a) wrapper testid 에 floor 가 직접 부여된 슬롯
    for (const tid of ['slot-col-treatment-rooms', 'slot-col-laser-rooms']) {
      const el = page.getByTestId(tid);
      if (await el.count() === 0) continue;
      const minH = await minHeightPx(el);
      expect(Math.abs(minH - BASELINE), `${tid} min-height ${minH} != ${BASELINE}`).toBeLessThanOrEqual(1);
    }
    // (b) DroppableColumn root 에 floor 가 부여된 비대상 칸반 컬럼(치료대기) — 동작 불변
    const tw = page.locator('[data-droppable-id="treatment_waiting"]');
    if (await tw.count() > 0) {
      const minH = await minHeightPx(tw);
      expect(Math.abs(minH - BASELINE), `treatment_waiting min-height ${minH} != ${BASELINE}`).toBeLessThanOrEqual(1);
    }
  });

  // AC-4: 콘솔 에러 0
  test('AC-4: 콘솔 에러 0', async ({ page }) => {
    await page.waitForTimeout(1000);
    const real = consoleErrors.filter((e) => !/favicon|ResizeObserver loop/i.test(e));
    expect(real, `콘솔 에러: ${real.join(' | ')}`).toHaveLength(0);
  });
});
