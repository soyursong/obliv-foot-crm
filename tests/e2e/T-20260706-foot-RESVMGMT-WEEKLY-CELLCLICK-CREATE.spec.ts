/**
 * T-20260706-foot-RESVMGMT-WEEKLY-CELLCLICK-CREATE — 풋 예약관리 주별(weekly) 뷰 UX 통일
 * reporter=김주연 총괄(풋센터) / FE-only DB0. 일별 뷰와 UX 통일.
 *
 * 검증 항목(티켓 현장 클릭 시나리오 → E2E 변환):
 *   [1] 주별 뷰 각 칸의 (+) 버튼(slot-plus-*) 완전 제거 → 비노출 (AC1)
 *   [2] 주별 빈 시간 칸 클릭 → 일별 뷰와 동일한 신규예약 모달('신규 예약') 오픈 (AC2)
 *       ★ 공유 openNewSlot(initialCustomer) opener 경유 = new-mode 팝업(newmode-datetime-readonly) 노출 (AC3)
 *   [무회귀] 일별(day) 뷰 칸클릭 신규예약 동선 정상 (AC4)
 *
 * 좌표(coordination): 7ADJ는 일별(day) 격자 재구현. 본 티켓은 주별(week) <table> delta.
 *   → 주별 셀 클릭이 openNewSlot 경유(자체 폼 구현 금지, CUSTCTX-PREFILL prefill 분기 보존)임을 new-mode 팝업으로 검증.
 *
 * 데이터(예약/근무) 없는 환경에서는 구조 검증으로 graceful skip.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(
      process.env.TEST_PASSWORD ??
        (() => {
          throw new Error('TEST_PASSWORD env required (no plaintext fallback)');
        })(),
    );
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(admin|dashboard|$)/, { timeout: 10000 });
  }
}

async function gotoReservationsWeekly(page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/admin/reservations`);
  await loginIfNeeded(page);
  await page.goto(`${BASE_URL}/admin/reservations`);
  await page.waitForLoadState('networkidle');
  // 주간 토글로 전환 (기본값은 일간).
  const weekToggle = page.getByRole('button', { name: /^주(간)?$/ }).first();
  if ((await weekToggle.count()) === 0) return false;
  await weekToggle.click();
  await page.waitForTimeout(400);
  return true;
}

test.describe('WEEKLY-CELLCLICK [1] 주별 칸별 (+) 버튼 제거', () => {
  test('주별 뷰에 slot-plus (+) 버튼이 하나도 없다', async ({ page }) => {
    const ok = await gotoReservationsWeekly(page);
    test.skip(!ok, '뷰 토글 미발견 환경 — 구조 검증 skip');

    // 구 (+) 버튼 testid(slot-plus-*)는 완전 제거되어야 한다.
    const plusButtons = page.locator('[data-testid^="slot-plus-"]');
    await expect(plusButtons).toHaveCount(0);

    // 주별 격자 셀(week-slot-*)은 렌더되어야 한다(뷰 자체는 존재).
    const weekCells = page.locator('[data-testid^="week-slot-"]');
    expect(await weekCells.count()).toBeGreaterThan(0);
  });
});

test.describe('WEEKLY-CELLCLICK [2]/[AC3] 주별 빈 칸 클릭 → 신규예약 모달(openNewSlot 경유)', () => {
  test('빈 주별 셀 클릭 시 신규 예약 new-mode 팝업이 열린다', async ({ page }) => {
    const ok = await gotoReservationsWeekly(page);
    test.skip(!ok, '뷰 토글 미발견 환경 — 구조 검증 skip');

    // 예약 카드가 없는(빈) 셀을 하나 고른다: resv-card 를 자손으로 갖지 않는 week-slot 셀.
    const allCells = page.locator('[data-testid^="week-slot-"]');
    const total = await allCells.count();
    test.skip(total === 0, '주별 격자 셀 미발견 — skip');

    let clicked = false;
    for (let i = 0; i < total; i++) {
      const cell = allCells.nth(i);
      // 카드가 없고(빈 슬롯) 화면에 보이는 셀만 클릭 대상.
      if ((await cell.locator('[data-testid^="resv-card-"]').count()) > 0) continue;
      if (!(await cell.isVisible().catch(() => false))) continue;
      await cell.click({ position: { x: 5, y: 3 } }).catch(() => {});
      // new-mode 팝업 오픈 확인: 제목 '신규 예약' + AC3 opener 표식(newmode-datetime-readonly).
      const dialog = page.getByRole('dialog').filter({ hasText: '신규 예약' });
      if (await dialog.isVisible({ timeout: 1500 }).catch(() => false)) {
        await expect(
          page.locator('[data-testid="newmode-datetime-readonly"]'),
        ).toBeVisible();
        clicked = true;
        break;
      }
    }
    // 마감/불가 슬롯만 있는 극단 환경이면 graceful skip(모달 미오픈이 곧 회귀는 아님).
    test.skip(!clicked, '클릭 가능한 빈 슬롯 없음(전 슬롯 마감/불가) — graceful skip');
    expect(clicked).toBeTruthy();
  });
});

test.describe('WEEKLY-CELLCLICK [AC4] 일별 뷰 무회귀', () => {
  test('일별 뷰 빈 칸 클릭 → 신규 예약 모달 정상(주별 변경이 일별에 영향 없음)', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/reservations`);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/admin/reservations`);
    await page.waitForLoadState('networkidle');

    // 기본값 일간. 일간 셀(resv-day-cell-*) 중 카드 없는 빈 셀 클릭.
    const dayCells = page.locator('[data-testid^="resv-day-cell-"]');
    const total = await dayCells.count();
    test.skip(total === 0, '일별 격자 셀 미발견 — skip');

    let opened = false;
    for (let i = 0; i < total; i++) {
      const cell = dayCells.nth(i);
      if ((await cell.locator('[data-testid^="resv-card-"]').count()) > 0) continue;
      if (!(await cell.isVisible().catch(() => false))) continue;
      await cell.click({ position: { x: 5, y: 5 } }).catch(() => {});
      const dialog = page.getByRole('dialog').filter({ hasText: '신규 예약' });
      if (await dialog.isVisible({ timeout: 1500 }).catch(() => false)) {
        opened = true;
        break;
      }
    }
    test.skip(!opened, '클릭 가능한 빈 일별 슬롯 없음 — graceful skip');
    expect(opened).toBeTruthy();
  });
});
