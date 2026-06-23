/**
 * E2E spec — T-20260623-foot-DASH-WORKSTAFF-ROSTER-SECTION
 * 대시보드 좌측 패널(CalendarNoticePanel)의 달력 섹션과 공지사항 섹션 사이에
 * [근무캘린더] 섹션 신설 — 금일 출근 직원을 의사/실장/코디/치료 4파트로 그룹핑 표시.
 *
 * 데이터 소스 = 공유 accessor fetchTodayWorkingStaffIds(현 duty-sheet-read EF) 경유(AC3).
 *   신규 시트 직접 호출 0 → SSOT source-swap 자동 전파.
 *
 * AC1: 달력 섹션 하단 / 공지사항 섹션 상단 사이에 [근무캘린더] 섹션 렌더.
 * AC2: 의사/실장/코디/치료 4파트로 그룹핑되어 display_name 표시(flex-wrap 줄내림).
 * AC4: graceful — 데이터 없음/EF 실패 시 섹션만 빈칸/로딩, 달력·공지 정상 렌더(에러화면 금지).
 * AC5: 기존 달력·공지 회귀 0.
 *
 * 검증 방식: 실브라우저(desktop-chrome, PC 1280px). 패널은 디폴트 접힘이므로
 *   pc-cal-expand 로 펼친 뒤 섹션 확인.
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

async function openPanel(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });
  // 디폴트 접힘(pc-cal-bar) → 펼치기
  await page.getByTestId('pc-cal-expand').click();
  await expect(page.getByTestId('pc-cal-toggle')).toBeVisible();
}

test.describe('T-20260623-foot-DASH-WORKSTAFF-ROSTER-SECTION — 근무캘린더 섹션', () => {
  test('AC1: 달력 섹션과 공지사항 섹션 사이에 [근무캘린더] 섹션 렌더', async ({ page }) => {
    await openPanel(page);

    const roster = page.getByTestId('duty-roster-section');
    await expect(roster).toBeVisible();
    // 섹션 헤더 라벨
    await expect(roster.getByText('근무캘린더')).toBeVisible();

    // AC5: 달력(헤더) + 공지사항 섹션 동시 정상 렌더 (회귀 0)
    await expect(page.getByText('달력').first()).toBeVisible();
    await expect(page.getByText('공지사항').first()).toBeVisible();
  });

  test('AC1(순서): DOM 상 달력 → 근무캘린더 → 공지사항 순서', async ({ page }) => {
    await openPanel(page);

    // 근무캘린더 섹션이 공지사항보다 앞에 위치하는지 (DOM 순서)
    const ordered = await page.evaluate(() => {
      const roster = document.querySelector('[data-testid="duty-roster-section"]');
      const noticeHeader = Array.from(document.querySelectorAll('span')).find(
        (el) => el.textContent?.trim() === '공지사항',
      );
      if (!roster || !noticeHeader) return false;
      // roster 가 공지사항 헤더보다 문서상 먼저 등장하면 DOCUMENT_POSITION_FOLLOWING
      return !!(roster.compareDocumentPosition(noticeHeader) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(ordered).toBe(true);
  });

  test('AC2/AC4: 4파트 라벨 또는 graceful 빈/로딩 상태 (에러화면 금지)', async ({ page }) => {
    await openPanel(page);

    const roster = page.getByTestId('duty-roster-section');
    await expect(roster).toBeVisible();

    // 로딩 종료 대기 (로딩 testid 가 사라질 때까지, 최대 10s — graceful 빈상태도 허용)
    await expect(page.getByTestId('roster-loading')).toHaveCount(0, { timeout: 10_000 });

    const hasParts = await page.getByTestId('roster-part-의사').count();
    if (hasParts > 0) {
      // 출근자 있음 → 4파트 라벨 전부 렌더
      for (const label of ['의사', '실장', '코디', '치료']) {
        await expect(page.getByTestId(`roster-part-${label}`)).toBeVisible();
      }
    } else {
      // graceful: 출근 정보 없음 안내(에러화면 아님)
      await expect(page.getByTestId('roster-empty')).toBeVisible();
    }

    // AC4: 섹션 상태와 무관하게 달력·공지 정상 렌더
    await expect(page.getByText('달력').first()).toBeVisible();
    await expect(page.getByText('공지사항').first()).toBeVisible();
  });
});
