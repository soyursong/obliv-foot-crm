/**
 * E2E spec — T-20260615-foot-CALENDAR-DEFAULT-COLLAPSED
 * 진료대시보드 등 진입 시 좌측 달력(CalendarNoticePanel) 패널이 항상 '접힘' 상태로 시작.
 *
 * 변경: CalendarNoticePanel `pcCollapsed` 초기값 false → true (FE presentation only, DB 변경 없음).
 * 마지막 상태 기억(localStorage) 로직 없음 → 매 진입·새로고침마다 항상 접힘으로 시작.
 *
 * AC-1: 진입 시 PC 달력이 접힘(pc-cal-bar) 상태 + 펼치기 버튼(pc-cal-expand) 노출.
 * AC-2: 펼치기 클릭 → 미니캘린더 정상 렌더, 접기 토글(pc-cal-toggle) 노출.
 * AC-3: 새로고침 후 재진입 시 다시 접힘 상태.
 *
 * 검증 방식: 실브라우저(desktop-chrome, PC 1280px).
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

test.describe('T-20260615-foot-CALENDAR-DEFAULT-COLLAPSED — 달력 디폴트 접힘', () => {
  test('AC-1: 진입 시 PC 달력은 접힘 상태로 시작', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    // 디폴트 접힘 strip 노출 + 펼치기 버튼
    await expect(page.getByTestId('pc-cal-bar')).toBeVisible();
    await expect(page.getByTestId('pc-cal-expand')).toBeVisible();

    // 펼침 상태 토글 버튼(접기)은 노출되지 않음
    await expect(page.getByTestId('pc-cal-toggle')).toHaveCount(0);
  });

  test('AC-2: 펼치기 클릭 → 미니캘린더 정상 노출', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    await page.getByTestId('pc-cal-expand').click();

    // 펼쳐진 패널 헤더(달력) + 접기 토글 노출
    await expect(page.getByText('달력').first()).toBeVisible();
    await expect(page.getByTestId('pc-cal-toggle')).toBeVisible();
    // 펼친 뒤에는 접힘 strip 사라짐
    await expect(page.getByTestId('pc-cal-bar')).toHaveCount(0);
  });

  test('AC-3: 새로고침 재진입 시 다시 접힘', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    // 한번 펼친 뒤
    await page.getByTestId('pc-cal-expand').click();
    await expect(page.getByTestId('pc-cal-toggle')).toBeVisible();

    // 새로고침 → 마지막상태 기억 없음 → 다시 접힘으로 시작
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByTestId('pc-cal-bar')).toBeVisible();
    await expect(page.getByTestId('pc-cal-expand')).toBeVisible();
  });
});
