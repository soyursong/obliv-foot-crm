/**
 * E2E spec — T-20260629-foot-STAFFCAL-COMPACT-PASTEL-DASHDUP-REMOVE (P2/UX, 김주연 총괄)
 *
 * 두 항목 중 item2(대시보드 하단 중복 근무자·인수인계 블록 제거)를 검증한다.
 *
 * ── item1 (인수인계/출근자 컬러박스 컴팩트 + 파스텔) 는 동일 reporter·동일 thread 의
 *    선행 자매 티켓 T-20260629-foot-HANDOVER-COMPACT-PASTEL (deployed, commit b4deac63)에서
 *    이미 전량 구현·spec(tests/e2e/T-20260629-foot-HANDOVER-COMPACT-PASTEL.spec.ts) 완료됨.
 *    REDEFINITION_RISK 흡수 — 본 spec 은 item1 을 재검증하지 않고 item2 + 회귀에 집중.
 *
 * ── 중복 구조 (코드 근거):
 *    (A) CalendarNoticePanel(좌측 고정 패널, /admin·/admin/reservations 노출)이 날짜 클릭과
 *        무관히 '근무캘린더(duty-roster-section) + 인수인계(duty-roster-handover)'를 상시 렌더.
 *    (B) DashboardDateDetail(하단 인라인, ?date= day-click 시에만)이 동일 데이터·문구를 렌더.
 *    → 대시보드에서 (A)·(B)가 동시 노출되어 중복. reporter: (B) day-click(빨간박스)=보존,
 *      (A) 상시표시(파란박스)=제거.
 *    fix: CalendarNoticePanel 의 (A) 섹션을 대시보드(/admin)에서만 숨김.
 *      예약관리(/admin/reservations)에는 DashboardDateDetail 이 없어 중복 아님 → 유지.
 *      day-click(DASHCAL: DashboardDateDetail) 은 일절 미변경(보존).
 *
 * AC-4: 대시보드 하단(상시표시) 중복 근무자·인수인계 블록 제거.
 * AC-5: 대시보드 day-click(DASHCAL) 인수인계/근무 현황 표시 정상(회귀 없음).
 * (AC-6 데이터/소스/집계 무변경은 순수 렌더 게이트라 코드 diff 로 보증 — FE 표시만 차단.)
 *
 * 검증 방식: 실브라우저(desktop-chrome, 1280px). 데이터 의존부 graceful.
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

test.describe('T-20260629-foot-STAFFCAL-COMPACT-PASTEL-DASHDUP-REMOVE — item2 대시보드 상시 중복 제거', () => {
  test('AC-4: 대시보드(/admin)에서 상시표시 근무캘린더+인수인계 섹션이 렌더되지 않는다(중복 제거)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    // CalendarNoticePanel 자체(미니달력/공지)는 살아있다 — 패널 통째 제거가 아님을 보증.
    // 단, 상시표시 근무캘린더 섹션 + 그 안의 인수인계 섹션은 대시보드에서 DOM 에 없어야 한다.
    await expect(page.getByTestId('duty-roster-section')).toHaveCount(0);
    await expect(page.getByTestId('duty-roster-handover')).toHaveCount(0);
  });

  test('스코프 가드: 예약관리(/admin/reservations)에서는 근무캘린더+인수인계 섹션이 유지된다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin/reservations', { waitUntil: 'networkidle' });

    // 예약관리에는 하단 DashboardDateDetail 이 없어 중복이 아니므로 좌측 패널 섹션은 보존되어야 한다.
    await expect(page.getByTestId('duty-roster-section')).toHaveCount(1);
  });

  test('AC-5 회귀: 대시보드 day-click(?date=) 하단 인라인 현황(DashboardDateDetail)은 정상 동작', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const now = new Date();
    const targetStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    await page.goto(`${BASE}/admin?date=${targetStr}`, { waitUntil: 'networkidle' });

    // day-click 결과(빨간박스, 보존 대상)는 그대로 렌더되어야 한다.
    await expect(page.getByTestId('dashboard-date-detail')).toBeVisible();
    await expect(page.getByTestId('dashboard-date-detail-roster')).toBeVisible();
    await expect(page.getByTestId('dashboard-date-detail-handover')).toBeVisible();

    // 동시에, 상시표시 중복 섹션은 여전히 없어야 한다(?date= 상태에서도 대시보드면 중복 금지).
    await expect(page.getByTestId('duty-roster-section')).toHaveCount(0);
  });

  test('AC-5 회귀: day-click 닫기 후 대시보드 본문 무회귀(/admin 유지)', async ({ page }) => {
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
