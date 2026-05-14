/**
 * T-20260514-foot-MOBILE-CAL-COLLAPSE
 * 모바일 달력 자동 접기 — 좌측 달력+공지가 모바일 화면 대부분 차지, 시간표 안 보임
 *
 * AC-1: 모바일(≤768px) 달력 자동 접힘 → 날짜 바 한 줄
 * AC-2: 날짜 바 탭 → 풀 달력 펼침
 * AC-3: 날짜 선택 → 다시 접힘
 * AC-4: 접힌 상태에서 시간표 전체 화면
 * AC-5: PC(≥769px) 변경 없음
 * AC-6: 공지 영역도 모바일 접힘
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8082';

test.describe('T-20260514-foot-MOBILE-CAL-COLLAPSE — 모바일 달력 자동 접기', () => {
  // ── 시나리오 1: 모바일 정상 동선 ─────────────────────────────────────────
  test('AC-1: 모바일(≤768px) 접속 시 달력 접혀 날짜 바만 보임', async ({ page }) => {
    // 모바일 뷰포트 설정
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    // AC-1: 날짜 바(mobile-cal-bar)가 보임
    const calBar = page.getByTestId('mobile-cal-bar');
    await expect(calBar).toBeVisible();

    // AC-1: 날짜 텍스트 포함 (예: "5월 14일 (수)" 형태)
    await expect(calBar).toContainText('월');
    await expect(calBar).toContainText('일');

    // AC-6: 공지 영역 포함한 전체 달력 패널이 접혀 있음 (달력 닫기 버튼 없음)
    await expect(page.getByTestId('mobile-cal-close')).not.toBeVisible();
  });

  test('AC-2: 날짜 바 탭 → 풀 달력 펼쳐짐', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    const calBar = page.getByTestId('mobile-cal-bar');
    await expect(calBar).toBeVisible();

    // 날짜 바 클릭 → 풀 달력 펼침
    await calBar.click();

    // 달력이 펼쳐짐 (달력 닫기 버튼 보임)
    await expect(page.getByTestId('mobile-cal-close')).toBeVisible();

    // 달력 접기 버튼이 있는 헤더 표시 확인
    await expect(page.getByRole('button', { name: '달력 접기' })).toBeVisible();
  });

  test('AC-3: 날짜 선택 → 달력 다시 접힘', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    // 달력 펼침
    await page.getByTestId('mobile-cal-bar').click();
    await expect(page.getByTestId('mobile-cal-close')).toBeVisible();

    // 현재 월의 날짜 셀 하나 클릭 (숫자 "15" 버튼)
    // 날짜 그리드에서 현재 월에 속한 '15' 클릭
    const dateButtons = page.locator('aside button').filter({ hasText: /^1[0-9]$/ }).first();
    await dateButtons.click();

    // AC-3: 달력이 다시 접히고 날짜 바가 보임
    await expect(page.getByTestId('mobile-cal-bar')).toBeVisible();
    await expect(page.getByTestId('mobile-cal-close')).not.toBeVisible();
  });

  test('AC-4: 접힌 상태에서 outlet(메인 콘텐츠)이 전체 화면 차지', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    // 달력 접힌 상태 확인
    await expect(page.getByTestId('mobile-cal-bar')).toBeVisible();

    // 메인 콘텐츠 영역이 존재하고 보임 (Outlet)
    // flex-col 레이아웃에서 날짜 바 아래 전체 영역을 차지
    const main = page.locator('main');
    await expect(main).toBeVisible();

    // aside(달력 패널)가 full w-72 형태로 나타나지 않음 — mobile-cal-bar만 존재
    const aside = page.locator('aside');
    await expect(aside).not.toBeVisible();
  });

  // ── 시나리오 2: PC 변경 없음 ─────────────────────────────────────────────
  test('AC-5: PC(≥769px)에서 달력+시간표 나란히 표시, 날짜 바 없음', async ({ page }) => {
    // PC 뷰포트
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    // 날짜 바(mobile-cal-bar)가 보이지 않음
    await expect(page.getByTestId('mobile-cal-bar')).not.toBeVisible();

    // 좌측 aside 패널(달력)이 보임
    const aside = page.locator('aside').first();
    await expect(aside).toBeVisible();

    // 달력 헤더 보임 (CalendarDays + "달력" 텍스트)
    await expect(page.getByText('달력').first()).toBeVisible();
  });
});
