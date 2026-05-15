/**
 * T-20260516-foot-PC-CAL-COLLAPSE
 * PC 달력 접기 (모바일 달력 접기 확장)
 *
 * AC-1: PC(≥769px) 달력 접기/펼치기 토글 버튼 표시
 * AC-2: 토글 클릭 → 달력 접힘 (날짜 바 strip + 날짜 텍스트)
 * AC-3: 날짜 선택 → 자동 접힘
 * AC-4: 접힌 상태에서 날짜 바 / 펼치기 버튼 클릭 → 달력 펼쳐짐
 * AC-5: 접힌 상태 시간표 영역 확장 (aside w-10)
 * AC-6: PC 초기 상태는 펼쳐진 상태
 * AC-7: 공지 영역도 달력과 함께 접힘
 * AC-8: 모바일 기존 자동 접기 regression 없음
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8082';

test.describe('T-20260516-foot-PC-CAL-COLLAPSE — PC 달력 접기', () => {

  // ── 시나리오 1: PC 초기 상태 + 토글 ─────────────────────────────────────
  test('AC-6: PC(≥769px) 초기 접속 시 달력 펼쳐진 상태', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    // AC-6: 초기에 pc-cal-bar(접힌 상태)가 아님
    await expect(page.getByTestId('pc-cal-bar')).not.toBeVisible();

    // 풀 달력 aside가 보임
    const aside = page.locator('aside').first();
    await expect(aside).toBeVisible();

    // AC-1: 접기 토글 버튼 보임
    await expect(page.getByTestId('pc-cal-toggle')).toBeVisible();
  });

  test('AC-1: PC 접기 토글 버튼 표시 확인', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    const toggle = page.getByTestId('pc-cal-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-label', '달력 접기');
  });

  test('AC-2: 토글 클릭 → 달력 접힘, 날짜 바 strip 표시', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    // 토글 클릭 → 접기
    await page.getByTestId('pc-cal-toggle').click();

    // AC-2: pc-cal-bar(aside strip)가 보임
    const pcBar = page.getByTestId('pc-cal-bar');
    await expect(pcBar).toBeVisible();

    // 날짜 텍스트 포함 ("월", "일" 포함)
    await expect(pcBar).toContainText('월');
    await expect(pcBar).toContainText('일');

    // AC-7: 공지 영역도 접혀 있음 (notice content 안 보임)
    await expect(page.locator('[data-testid="pc-cal-toggle"]')).not.toBeVisible();
  });

  test('AC-5: 접힌 상태에서 aside가 좁아짐 (w-10)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    await page.getByTestId('pc-cal-toggle').click();

    const pcBar = page.getByTestId('pc-cal-bar');
    await expect(pcBar).toBeVisible();

    // aside width가 좁음 (w-10 = 40px)
    const box = await pcBar.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThan(60);
  });

  test('AC-4: 접힌 상태에서 펼치기 버튼 클릭 → 달력 펼쳐짐', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    // 접기
    await page.getByTestId('pc-cal-toggle').click();
    await expect(page.getByTestId('pc-cal-bar')).toBeVisible();

    // 펼치기
    await page.getByTestId('pc-cal-expand').click();

    // 풀 달력으로 복귀
    await expect(page.getByTestId('pc-cal-bar')).not.toBeVisible();
    await expect(page.getByTestId('pc-cal-toggle')).toBeVisible();
  });

  test('AC-3: 날짜 선택 → PC 달력 자동 접힘', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    // 달력 펼쳐진 상태 확인
    await expect(page.getByTestId('pc-cal-toggle')).toBeVisible();

    // 날짜 그리드에서 현재 월의 날짜 버튼 클릭
    const dateButtons = page.locator('aside button').filter({ hasText: /^\d{1,2}$/ }).first();
    await dateButtons.click();

    // AC-3: 달력이 자동 접힘 → pc-cal-bar 보임
    await expect(page.getByTestId('pc-cal-bar')).toBeVisible();
  });

  // ── 시나리오 2: 모바일 regression ────────────────────────────────────────
  test('AC-8: 모바일(≤768px) 기존 자동 접기 regression 없음', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    // 모바일: 날짜 바(mobile-cal-bar)가 보임
    await expect(page.getByTestId('mobile-cal-bar')).toBeVisible();

    // PC 관련 요소는 없음
    await expect(page.getByTestId('pc-cal-bar')).not.toBeVisible();
    await expect(page.getByTestId('pc-cal-toggle')).not.toBeVisible();

    // 날짜 바 클릭 → 펼쳐짐
    await page.getByTestId('mobile-cal-bar').click();
    await expect(page.getByTestId('mobile-cal-close')).toBeVisible();

    // 날짜 클릭 → 다시 접힘
    const dateButtons = page.locator('aside button').filter({ hasText: /^\d{1,2}$/ }).first();
    await dateButtons.click();
    await expect(page.getByTestId('mobile-cal-bar')).toBeVisible();
  });
});
