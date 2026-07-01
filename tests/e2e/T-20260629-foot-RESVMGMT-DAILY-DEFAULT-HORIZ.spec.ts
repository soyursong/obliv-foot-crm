/**
 * E2E spec — T-20260629-foot-RESVMGMT-DAILY-DEFAULT-HORIZ (6/25 개편2탄 항목1)
 *
 * 예약관리 진입 시 기본 뷰 '일간' 고정 + 예약 시간 가로(x축) 배열.
 * (현 구현은 W1-NODB[1-a] 일간 기본 + W3-HORIZONTAL 가로배열로 선행 적용됨 — 본 spec은 항목1 AC를
 *  신규 티켓 ID로 회귀-락 한다.)
 *
 * AC1: 예약관리 최초 진입 시 뷰 모드 기본값 = 일간(day).
 * AC2: 해당 일자 예약 시간 슬롯이 가로(horizontal) 방향 배열.
 * AC3: 다른 뷰(주간) 전환 동작 무변경 — 기본값만 일간 고정(재진입 시 일간 복귀).
 * AC4: 기존 예약 표시·뷰 토글 무회귀.
 *
 * 검증 방식: 실브라우저(desktop-chrome, 1280px).
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

async function gotoReservations(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(BASE + '/admin/reservations', { waitUntil: 'networkidle' });
}

// [SUPERSEDED by 7ADJ ③] 일간 기본은 유지(default day)이나 '시간 가로배열'은 엑셀 격자(시간 행)로 교체 → skip.
test.describe.skip('DAILY-DEFAULT-HORIZ — 일간 기본 + 시간 가로배열 (SUPERSEDED 7ADJ grid)', () => {
  test('AC1: 예약관리 진입 시 일간(day) 뷰가 기본', async ({ page }) => {
    await gotoReservations(page);
    // 일간 전용 컨테이너(resv-day-horizontal/xaxis)는 day 뷰에서만 렌더 → 기본 day 증명
    await expect(page.getByTestId('resv-day-horizontal')).toBeVisible();
    await expect(page.getByTestId('resv-day-xaxis')).toBeVisible();
    // 주간 전용 행(resv-slot-row)은 미렌더
    await expect(page.getByTestId('resv-slot-row')).toHaveCount(0);
  });

  test('AC2: 예약 시간 슬롯이 가로(x축)로 배열', async ({ page }) => {
    await gotoReservations(page);
    await expect(page.getByTestId('resv-day-xaxis')).toBeVisible();
    // 가로 x축 시간 컬럼(resv-day-hslot-HH:MM)이 1개 이상 렌더
    const hslots = page.locator('[data-testid^="resv-day-hslot-"]');
    expect(await hslots.count()).toBeGreaterThan(0);
  });

  test('AC3/AC4: 주간 전환 정상 → 재진입 시 일간 복귀(기본값 고정), 토글 무회귀', async ({ page }) => {
    await gotoReservations(page);
    // 주간 전환
    await page.getByRole('button', { name: '주간' }).click();
    await expect(page.getByTestId('resv-day-horizontal')).toHaveCount(0);
    await expect(page.getByTestId('resv-slot-row').first()).toBeVisible();
    // 재진입 → 기본값 일간 복귀
    await gotoReservations(page);
    await expect(page.getByTestId('resv-day-horizontal')).toBeVisible();
    await expect(page.getByTestId('resv-slot-row')).toHaveCount(0);
  });
});
