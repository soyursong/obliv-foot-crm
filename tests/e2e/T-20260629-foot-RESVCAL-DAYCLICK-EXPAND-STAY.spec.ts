/**
 * E2E spec — T-20260629-foot-RESVCAL-DAYCLICK-EXPAND-STAY (6/25 개편2탄 항목7)
 *
 * 예약관리 달력 일자 클릭 시 접히지 않고 펼친 상태 유지 + 해당 일자 예약현황으로 이동.
 * (현 구현은 CalendarNoticePanel W1-NODB[7]: 예약관리 진입 펼침 + 일자클릭 자동접힘 제거 + ?date= 이동으로
 *  선행 적용 — 본 spec은 항목7 AC를 신규 티켓 ID로 회귀-락 한다.)
 *
 * AC1: 예약관리 달력 일자 클릭 시 달력이 접히지 않고 펼친 상태 유지.
 * AC2: 클릭 일자의 예약 현황으로 이동(?date= 갱신 + 일간 그리드 해당일 렌더).
 * AC3: 기존 예약 카드 동선 무회귀.
 * AC4: 인접 건(RESV-LIVE-AUTOSCROLL-REGRESSION)과 스크롤 동작 충돌 없음(클릭 후 크래시·접힘 없음).
 *
 * 검증 방식: 실브라우저(desktop-chrome, 1280px).
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

test.describe('T-20260629-foot-RESVCAL-DAYCLICK-EXPAND-STAY — 일자클릭 펼침유지 + 해당일 이동', () => {
  test('AC1: 예약관리 진입 시 달력 펼침 + 일자 클릭 후에도 펼침 유지(자동접힘 없음)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin/reservations', { waitUntil: 'networkidle' });
    // 예약관리 진입 시 달력은 펼친 상태(pc-cal-toggle=접기 버튼 노출), 접힘 바(pc-cal-bar) 미노출
    await expect(page.getByTestId('pc-cal-toggle')).toBeVisible();
    await expect(page.getByTestId('pc-cal-bar')).toHaveCount(0);

    const now = new Date();
    const targetDom = now.getDate() === 15 ? 10 : 15;
    const targetStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(targetDom)}`;
    await page.getByTestId(`cal-day-${targetStr}`).click();

    // 클릭 후에도 달력은 펼친 상태 유지(접히지 않음)
    await expect(page.getByTestId('pc-cal-toggle')).toBeVisible();
    await expect(page.getByTestId('pc-cal-bar')).toHaveCount(0);
  });

  test('AC2: 일자 클릭 시 해당 일자 예약현황으로 이동(?date= 갱신)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin/reservations', { waitUntil: 'networkidle' });

    const now = new Date();
    const targetDom = now.getDate() === 15 ? 10 : 15;
    const targetStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(targetDom)}`;
    await page.getByTestId(`cal-day-${targetStr}`).click();

    await expect(page).toHaveURL(new RegExp(`date=${targetStr}`));
    // 일간 그리드가 해당일로 렌더(가로 x축 유지)
    await expect(page.getByTestId('resv-day-horizontal')).toBeVisible();
  });

  test('AC3/AC4 회귀가드: 연속 클릭 시 매번 펼침 유지 + 크래시/스크롤충돌 없음', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin/reservations', { waitUntil: 'networkidle' });
    const now = new Date();
    for (const dom of [10, 20]) {
      const safe = now.getDate() === dom ? dom + 1 : dom;
      const ds = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(safe)}`;
      const cell = page.getByTestId(`cal-day-${ds}`);
      if ((await cell.count()) === 0) continue;
      await cell.click();
      await expect(page.getByTestId('pc-cal-toggle')).toBeVisible();
      await expect(page.getByTestId('resv-day-horizontal')).toBeVisible();
    }
  });
});
