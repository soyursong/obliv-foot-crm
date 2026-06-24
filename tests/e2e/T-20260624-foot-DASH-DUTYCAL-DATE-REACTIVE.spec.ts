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
 * 검증 방식: 실브라우저(desktop-chrome, PC 1280px). 패널 디폴트 접힘 → pc-cal-expand 로 펼친 뒤 검증.
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

async function openPanel(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });
  await page.getByTestId('pc-cal-expand').click();
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
    await expect(handover.getByText('인수인계')).toBeVisible();

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
