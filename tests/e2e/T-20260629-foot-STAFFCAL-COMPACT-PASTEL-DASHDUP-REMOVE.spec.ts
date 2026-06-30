/**
 * E2E spec — T-20260629-foot-STAFFCAL-COMPACT-PASTEL-DASHDUP-REMOVE (item2)
 *   2026-06-30 P1 HOTFIX — (A)/(B) 매핑 반대 적용 회귀 정정.
 *
 * ── 배경: 직전 배포(d3f908d0)는 reporter(김주연 총괄) 스크린샷의 빨강/파랑을 코드 surface에
 *    반대로 매핑했다. field-soak FAIL: "파란박스 제거 요청했는데 왜 빨간박스 구역이 사라졌을까".
 *
 * ── 스크린샷(F0BDDN2S8NB) 육안대조로 확정한 정답 매핑:
 *    🔴 빨간박스(보존) = 좌측 사이드바 근무캘린더+인수인계
 *         = CalendarNoticePanel duty-roster-section / duty-roster-handover.
 *         (T-20260624-DASH-DUTYCAL-DATE-REACTIVE로 selectedDate에 반응 = day-click 현황 담당)
 *    🔵 파란박스(제거) = 하단 인라인 "현황" 패널(예약/내원 카운트 + 근무스케줄 + 인수인계 중복)
 *         = DashboardDateDetail (?date= day-click 시 렌더).
 *
 * ── fix:
 *    (A) CalendarNoticePanel duty-roster-section 의 {!onDashboard} 게이트 제거 → 사이드바(빨강) 원복.
 *    (B) Dashboard.tsx 의 DashboardDateDetail 렌더 제거 → 하단(파랑) 중복 제거.
 *    사이드바 selectedDate 는 내부 state(URL 무관)라 day-click 현황은 사이드바가 계속 담당 → AC-5 보존.
 *
 * AC-4: 대시보드 하단 중복(DashboardDateDetail) 제거.
 * AC-5: day-click(DASHCAL) 인수인계/근무 현황 표시 정상 — 사이드바 근무캘린더가 클릭 날짜로 갱신.
 * (AC-6 데이터/소스/집계 무변경은 순수 렌더 게이트라 코드 diff 로 보증.)
 *
 * 검증 방식: 실브라우저(desktop-chrome, 1280px). 데이터 의존부 graceful.
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

test.describe('T-20260629-foot-STAFFCAL-COMPACT-PASTEL-DASHDUP-REMOVE — item2 HOTFIX(매핑 정정)', () => {
  test('보존(빨강): 대시보드(/admin)에서 사이드바 근무캘린더+인수인계 섹션이 살아있다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    // 직전 배포가 잘못 숨겼던 빨간박스(보존 대상)가 대시보드에서 다시 렌더되어야 한다.
    await expect(page.getByTestId('duty-roster-section')).toHaveCount(1);
    await expect(page.getByTestId('duty-roster-handover')).toHaveCount(1);
  });

  test('AC-4(파랑 제거): 대시보드에서 하단 인라인 현황(DashboardDateDetail)이 ?date= 에도 렌더되지 않는다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const now = new Date();
    const targetStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    // 과거 day-click 동작은 ?date= 를 URL 에 남겼다. 그 URL 로 직접 진입해도 하단 패널은 없어야 한다.
    await page.goto(`${BASE}/admin?date=${targetStr}`, { waitUntil: 'networkidle' });

    await expect(page.getByTestId('dashboard-date-detail')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-date-detail-roster')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-date-detail-handover')).toHaveCount(0);

    // 동시에, 보존 대상(사이드바)은 ?date= 상태에서도 살아있어야 한다.
    await expect(page.getByTestId('duty-roster-section')).toHaveCount(1);
  });

  test('AC-5(day-click 보존): 사이드바 달력에서 날짜 클릭 시 근무캘린더가 클릭 날짜로 갱신된다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    // 보존 섹션 확인
    const dateLabel = page.getByTestId('duty-roster-date-label');
    await expect(dateLabel).toBeVisible();

    // 현재 월 내, 오늘이 아닌 날짜를 골라 클릭 (라벨이 '금일 출근' → '{날짜} 출근' 으로 전환)
    const now = new Date();
    const today = now.getDate();
    const targetDay = today <= 15 ? 20 : 5;
    const targetKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(targetDay)}`;

    const cell = page.getByTestId(`cal-day-${targetKey}`);
    await expect(cell).toBeVisible();
    await cell.click();

    // 근무캘린더 날짜 라벨이 클릭한 날짜(M월 d일)로 바뀌어 day-click 현황을 담당함을 확인.
    await expect(dateLabel).toContainText(`${now.getMonth() + 1}월 ${targetDay}일`);

    // day-click 후에도 하단 중복 패널은 생기지 않아야 한다(AC-4 회귀 가드).
    await expect(page.getByTestId('dashboard-date-detail')).toHaveCount(0);
  });

  test('스코프 가드: 예약관리(/admin/reservations)에서도 사이드바 근무캘린더 섹션은 정상 유지', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin/reservations', { waitUntil: 'networkidle' });

    await expect(page.getByTestId('duty-roster-section')).toHaveCount(1);
  });
});
