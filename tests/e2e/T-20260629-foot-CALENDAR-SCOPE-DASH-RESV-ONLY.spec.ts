/**
 * E2E spec — T-20260629-foot-CALENDAR-SCOPE-DASH-RESV-ONLY (6/25 개편2탄 항목5)
 *
 * 달력 노출 범위 축소 — 전 화면 사이드바 노출 제거, 대시보드/예약관리에서만 표시.
 * (현 구현은 AdminLayout showSidebarCalendar = pathname '/admin' | '/admin/reservations' 로 선행 적용 —
 *  본 spec은 항목5 AC를 신규 티켓 ID로 회귀-락 한다.)
 *
 * AC1: 전역 사이드바(일반 화면)에서 달력 컴포넌트 미노출.
 * AC2: 대시보드(/admin) 달력 표시 유지.
 * AC3: 예약관리(/admin/reservations) 달력 표시 유지.
 * AC4: 달력 제거로 인한 다른 화면 기능 단절 없음(메뉴 네비 무회귀).
 *
 * 검증 방식: 실브라우저(desktop-chrome, 1280px). 달력 패널 존재 여부 = pc-cal-* / cal-day-* testid 유무.
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

// 달력 패널 존재 표지(접힘=pc-cal-expand 바, 펼침=pc-cal-toggle/cal-day-*) 합산 카운트
async function calendarPresenceCount(page: import('@playwright/test').Page): Promise<number> {
  const a = await page.getByTestId('pc-cal-expand').count();
  const b = await page.getByTestId('pc-cal-toggle').count();
  const c = await page.locator('[data-testid^="cal-day-"]').count();
  return a + b + c;
}

test.describe('T-20260629-foot-CALENDAR-SCOPE-DASH-RESV-ONLY — 달력 노출 범위 축소', () => {
  test('AC1: 일반 화면(고객관리)에서 달력 미노출', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin/customers', { waitUntil: 'networkidle' });
    expect(await calendarPresenceCount(page)).toBe(0);
  });

  test('AC2: 대시보드(/admin) 달력 표시 유지', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });
    expect(await calendarPresenceCount(page)).toBeGreaterThan(0);
  });

  test('AC3: 예약관리(/admin/reservations) 달력 표시 유지', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin/reservations', { waitUntil: 'networkidle' });
    expect(await calendarPresenceCount(page)).toBeGreaterThan(0);
  });

  test('AC4 회귀가드: 일반 화면 네비 메뉴 정상(달력만 빠짐)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin/customers', { waitUntil: 'networkidle' });
    // 사이드바 네비게이션(예약관리 메뉴 링크 등) 정상 노출
    await expect(page.getByRole('link', { name: /예약관리/ }).first()).toBeVisible();
  });
});
