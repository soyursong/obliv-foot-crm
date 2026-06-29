/**
 * E2E spec — T-20260629-foot-DASHCAL-DAYCLICK-STAFFCAL-HANDOVER (6/25 개편2탄 항목6)
 *
 * 대시보드 달력 일자 클릭 동작을 '예약관리 전환' → '그 자리에서 3종 인플레이스 표시'로 변경.
 *   ① 근무캘린더 그날 스케줄 ② 그날 인수인계 ③ 그날 대시보드 현황(집계).
 *
 * ★기존 소스 읽기만(AC5, 신규 스키마/집계 0):
 *   근무 = fetchAttendeesByDate + fetchActiveStaff / 인수인계 = handover_notes(target_date)
 *   현황 = reservations(reservation_date) + check_ins(checked_in_at) count (본문 fetch와 동일 필터).
 *
 * AC1: 대시보드 달력 날짜 클릭 시 예약관리로 화면 전환하지 않음(URL=/admin 유지).
 * AC2: 클릭 일자 근무캘린더 스케줄 표시.
 * AC3: 클릭 일자 인수인계 표시.
 * AC4: 클릭 일자 대시보드 현황(집계) 표시.
 *
 * 검증 방식: 실브라우저(desktop-chrome, 1280px). 데이터 의존부는 graceful(빈칸 허용)로 검증.
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

test.describe('T-20260629-foot-DASHCAL-DAYCLICK-STAFFCAL-HANDOVER — 대시보드 달력 일자클릭 인플레이스', () => {
  test('AC1: 대시보드 달력 날짜 클릭 → 예약관리로 이동하지 않음(/admin 유지)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });
    // 대시보드 진입 시 달력 패널은 접힘 기본 → 펼치기
    await page.getByTestId('pc-cal-expand').click();
    await expect(page.getByTestId('pc-cal-toggle')).toBeVisible();

    const now = new Date();
    const targetDom = now.getDate() === 15 ? 10 : 15;
    const targetStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(targetDom)}`;
    await page.getByTestId(`cal-day-${targetStr}`).click();

    // 화면 전환 없음 — 여전히 /admin (예약관리 /admin/reservations 가 아님)
    await expect(page).toHaveURL(/\/admin(\?|$)/);
    expect(page.url()).not.toContain('/admin/reservations');
  });

  test('AC2~AC4: ?date= 인플레이스 진입 시 근무스케줄 + 인수인계 + 대시보드 현황 3종 렌더', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const now = new Date();
    const targetStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    await page.goto(`${BASE}/admin?date=${targetStr}`, { waitUntil: 'networkidle' });

    const panel = page.getByTestId('dashboard-date-detail');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('dashboard-date-detail-label')).toBeVisible();

    // AC2: 근무스케줄 섹션
    await expect(page.getByTestId('dashboard-date-detail-roster')).toBeVisible();
    // AC3: 인수인계 섹션
    await expect(page.getByTestId('dashboard-date-detail-handover')).toBeVisible();
    // AC4: 대시보드 현황(집계) 섹션 — 신규
    await expect(page.getByTestId('dashboard-date-detail-status')).toBeVisible();
    // 로딩 종료 후 예약/내원 카운트 칩 노출(데이터 0이어도 칩 자체는 렌더; 조회 실패 시에만 empty)
    const statusEmpty = page.getByTestId('dashboard-date-detail-status-empty');
    if ((await statusEmpty.count()) === 0) {
      await expect(page.getByTestId('status-resv-count')).toBeVisible();
      await expect(page.getByTestId('status-visit-total')).toBeVisible();
    }
  });

  test('AC1 회귀가드: 닫기 후 대시보드 본문 무회귀', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const now = new Date();
    const targetStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    await page.goto(`${BASE}/admin?date=${targetStr}`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('dashboard-date-detail')).toBeVisible();
    await page.getByTestId('dashboard-date-detail-close').click();
    await expect(page.getByTestId('dashboard-date-detail')).toHaveCount(0);
    await expect(page).toHaveURL(/\/admin(\?|$)/);
  });
});
