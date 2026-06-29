/**
 * E2E spec — T-20260629-foot-CALENDAR-SCOPE-DASH-RESV-ONLY (6/25 개편2탄 항목5)
 *
 * 달력 노출 범위 축소 — 전 화면 사이드바 노출 제거, 대시보드/예약관리에서만 표시.
 * (구현: AdminLayout showSidebarCalendar = pathname '/admin' | '/admin/reservations' →
 *  CalendarNoticePanel 렌더. 두 화면은 펼친 상태로 시작(pcCollapsed false) → 달력/공지 노출.)
 *
 * AC1: 전역 사이드바(일반 화면)에서 달력 컴포넌트 미노출.
 * AC2: 대시보드(/admin) 달력 표시 유지 — '공지사항' 가시(QA phase2 회귀락).
 * AC3: 예약관리(/admin/reservations) 달력 표시 유지 — '공지사항' 가시.
 * AC4: 달력 제거로 인한 다른 화면 기능 단절 없음(메뉴 네비 무회귀).
 *
 * ⚠ QA-FIX(2026-06-29): 이전 spec은 calendarPresenceCount(접힘 strip pc-cal-expand 포함)으로
 *   AC2를 통과시켜 false-green. 실제 QA는 `text=공지사항` count≥1 을 검사 → 대시보드 접힘 시 0건 FAIL.
 *   본 spec은 AC2/AC3을 '공지사항' 가시(=패널 펼침)로 강화해 QA 실검사와 정합.
 *
 * 검증 방식: 실브라우저(desktop-chrome, 1280px).
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

test.describe('T-20260629-foot-CALENDAR-SCOPE-DASH-RESV-ONLY — 달력 노출 범위 축소', () => {
  test('AC1: 일반 화면(고객관리)에서 달력 미노출', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin/customers', { waitUntil: 'networkidle' });
    // 패널 자체 미렌더 → 접힘 strip·펼침 toggle·공지사항 모두 0
    expect(await page.getByTestId('pc-cal-expand').count()).toBe(0);
    expect(await page.getByTestId('pc-cal-toggle').count()).toBe(0);
    expect(await page.getByText('공지사항').count()).toBe(0);
  });

  test('AC2: 대시보드(/admin) 달력 표시 유지 — 공지사항 가시', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });
    // 펼친 상태(pcCollapsed false)로 시작 → 접기 토글 + 공지사항 영역 노출. QA `text=공지사항` count≥1 정합.
    await expect(page.getByTestId('pc-cal-toggle')).toBeVisible();
    expect(await page.getByText('공지사항').count()).toBeGreaterThan(0);
  });

  test('AC3: 예약관리(/admin/reservations) 달력 표시 유지 — 공지사항 가시', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin/reservations', { waitUntil: 'networkidle' });
    await expect(page.getByTestId('pc-cal-toggle')).toBeVisible();
    expect(await page.getByText('공지사항').count()).toBeGreaterThan(0);
  });

  test('AC4 회귀가드: 일반 화면 네비 메뉴 정상(달력만 빠짐)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin/customers', { waitUntil: 'networkidle' });
    // 사이드바 네비게이션(예약관리 메뉴 링크 등) 정상 노출
    await expect(page.getByRole('link', { name: /예약관리/ }).first()).toBeVisible();
  });
});
