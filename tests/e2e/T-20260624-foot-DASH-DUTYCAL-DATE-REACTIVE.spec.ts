/**
 * E2E spec — T-20260624-foot-DASH-DUTYCAL-DATE-REACTIVE
 *
 * 달력 밑 고정 [근무캘린더] 섹션(CalendarNoticePanel)을 today-fixed → 달력 선택 날짜에 반응하도록 정정.
 * 별도 하단 패널(DashboardDateDetail)이 아니라 상단 고정 섹션 자체가 클릭 날짜로 변동 + 인수인계 동반.
 *
 * 데이터 소스 = 하단 현황패널과 동일 date-param accessor 재사용(AC4):
 *   근무 = fetchAttendeesByDate(duty-sheet-read EF, 기존) + fetchActiveStaff.
 *   인수인계 = handover_notes(기존 테이블) target_date 필터.
 *   → 신규 EF/시트 직접 호출 0(SSOT split-brain 가드).
 *
 * AC1: 달력에서 다른 날짜 클릭 시, 달력 바로 아래 고정 [근무캘린더] 섹션이 그 날짜로 갱신(today 고정 X).
 * AC2: 날짜 클릭 시 해당 날짜 인수인계 동반 로드(있으면 내용, 없으면 "인수인계가 없습니다").
 * AC3: 첫 진입(오늘)엔 '금일 출근' 라벨 + 금일 명단(기본값=오늘).
 * AC5: graceful — 섹션 상태와 무관하게 달력·공지 정상 렌더(에러화면 금지).
 *
 * ── RESCOPE: 진입경로 /admin → /admin/reservations (T-20260630-foot-DUTYCAL-DATEREACTIVE-SPEC-RESCOPE-RESV) ──
 *   T-20260629-foot-STAFFCAL-COMPACT-...-DASHDUP-REMOVE item2(d3f908d0)가 (A)CalendarNoticePanel 의 상시
 *   근무캘린더(duty-roster-section)를 {!onDashboard &&} 로 감쌌다 → 대시보드(/admin)에선 영구 미렌더.
 *   단 (A) date-reactive 동작은 예약관리(/admin/reservations, onReservations·!onDashboard)에 보존된다
 *   (CalendarNoticePanel src/components, AdminLayout.showSidebarCalendar = /admin | /admin/reservations).
 *   → spec 은퇴 대신 진입경로만 /admin/reservations 로 재타겟해 커버리지 가치(날짜반응·인수인계동반)를 유지.
 *   소스 무변경(test-only). DashboardDateDetail(대시보드 하단 인라인 현황)은 본 spec 범위 밖(별 기능).
 *
 * 검증 방식: 실브라우저(desktop-chrome, PC 1280px).
 *   예약관리 진입 시 패널은 onReservations→pcCollapsed=false 로 '기본 펼침'(과거 /admin 디폴트 접힘과 다름).
 *   → pc-cal-expand 는 접힘 strip에서만 존재하므로 노출 시에만 graceful 클릭, 펼침은 pc-cal-toggle 로 확정.
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

async function openPanel(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  // RESCOPE: (A)CalendarNoticePanel 상시 근무캘린더 섹션은 STAFFCAL item2 이후 /admin 에선 미렌더 →
  //   예약관리(/admin/reservations)에서만 렌더되므로 진입경로를 재타겟한다.
  await page.goto(BASE + '/admin/reservations', { waitUntil: 'networkidle' });
  // 예약관리 진입 시 패널은 기본 펼침(onReservations→pcCollapsed=false). 단 초기 1프레임 접힘 strip이
  //   잡힐 가능성에 대비해 pc-cal-expand 가 실제로 보일 때만 graceful 펼침(없으면 이미 펼쳐진 상태).
  const expandBtn = page.getByTestId('pc-cal-expand');
  if (await expandBtn.isVisible().catch(() => false)) {
    await expandBtn.click();
  }
  // 펼침 확정 — 접기 토글(pc-cal-toggle)은 펼친 패널에만 존재.
  await expect(page.getByTestId('pc-cal-toggle')).toBeVisible();
}

test.describe('T-20260624-foot-DASH-DUTYCAL-DATE-REACTIVE — 근무캘린더 날짜 반응 + 인수인계', () => {
  test('AC3: 첫 진입(오늘) 라벨 = "금일 출근"', async ({ page }) => {
    await openPanel(page);
    const roster = page.getByTestId('duty-roster-section');
    await expect(roster).toBeVisible();
    await expect(page.getByTestId('duty-roster-date-label')).toHaveText('금일 출근');
  });

  test('AC1: 다른 날짜 클릭 → 상단 고정 [근무캘린더] 섹션 자체가 그 날짜로 갱신(라벨 변동)', async ({ page }) => {
    await openPanel(page);

    const label = page.getByTestId('duty-roster-date-label');
    await expect(label).toHaveText('금일 출근');

    // 현재 달의 today 가 아닌 날짜 셀 클릭 (그리드에 항상 포함되는 당월 중간 날짜)
    const now = new Date();
    const targetDom = now.getDate() === 15 ? 10 : 15;
    const targetStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(targetDom)}`;

    await page.getByTestId(`cal-day-${targetStr}`).click();

    // 상단 고정 섹션의 라벨이 '금일 출근' 이 아니라 선택 날짜 "M월 d일 (E) 출근" 으로 변동
    await expect(label).not.toHaveText('금일 출근');
    await expect(label).toContainText(`${targetDom}일`);
    await expect(label).toContainText('출근');

    // 섹션은 여전히 달력 바로 아래 고정(별도 하단 패널이 아님)
    await expect(page.getByTestId('duty-roster-section')).toBeVisible();
  });

  test('AC2: 날짜 클릭 시 인수인계 동반 로드(내용 또는 "인수인계가 없습니다")', async ({ page }) => {
    await openPanel(page);

    // 인수인계 하위 블록 자체가 섹션 안에 존재
    const handover = page.getByTestId('duty-roster-handover');
    await expect(handover).toBeVisible();
    // exact:true 필수 — 비exact 시 헤딩 span('인수인계')과 빈안내('인수인계가 없습니다')가 동시 매치되어
    //   strict-mode 위반(2 elements)으로 실패한다. 헤딩 라벨만 정확히 타겟.
    await expect(handover.getByText('인수인계', { exact: true })).toBeVisible();

    const now = new Date();
    const targetDom = now.getDate() === 20 ? 12 : 20;
    const targetStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(targetDom)}`;
    await page.getByTestId(`cal-day-${targetStr}`).click();

    // 로딩 종료 대기 (graceful 빈상태 허용)
    await expect(page.getByTestId('handover-loading')).toHaveCount(0, { timeout: 10_000 });

    // 인수인계 내용(list) 또는 빈 안내 둘 중 하나 — 에러화면 금지
    const hasList = await page.getByTestId('handover-list').count();
    if (hasList > 0) {
      await expect(page.getByTestId('handover-list')).toBeVisible();
    } else {
      await expect(page.getByTestId('handover-empty')).toBeVisible();
    }
  });

  test('AC5: 섹션 상태와 무관하게 달력·공지 정상 렌더(graceful, 회귀 0)', async ({ page }) => {
    await openPanel(page);

    // 로딩 종료 대기 (빈상태 허용)
    await expect(page.getByTestId('roster-loading')).toHaveCount(0, { timeout: 10_000 });

    await expect(page.getByText('달력').first()).toBeVisible();
    await expect(page.getByText('공지사항').first()).toBeVisible();

    // 출근자 있으면 4파트 라벨, 없으면 graceful 빈 안내
    const hasParts = await page.getByTestId('roster-part-의사').count();
    if (hasParts === 0) {
      await expect(page.getByTestId('roster-empty')).toBeVisible();
    }
  });
});
