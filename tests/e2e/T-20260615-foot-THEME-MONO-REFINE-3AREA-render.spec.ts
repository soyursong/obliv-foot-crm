import { test, expect } from '@playwright/test';

/**
 * T-20260615-foot-THEME-MONO-REFINE-3AREA — 인증 실렌더 (desktop-chrome, storageState)
 * 단계별 브라우저 렌더 확인 의무: AC1 통합시간표 슬롯 + AC3 근무 캘린더 치료사 탭 실화면 캡처.
 * AC2(2번차트)는 고객 id 의존으로 본 render 에서 제외(정적+컴파일 가드로 검증).
 */

test.describe('THEME-MONO-REFINE-3AREA — 인증 실렌더 evidence', () => {
  test('AC1: 대시보드 통합시간표 모노톤 슬롯 렌더', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // 통합시간표 컬럼 헤더 존재 확인 (timeline-time-col)
    const timeCol = page.locator('[data-testid="timeline-time-col"]').first();
    await expect(timeCol).toBeVisible({ timeout: 15_000 });
    await page.screenshot({
      path: 'evidence/T-20260615-foot-THEME-MONO-REFINE-3AREA_AC1-timetable.png',
      fullPage: true,
    });
  });

  test('AC3[SUPERSEDED→PARTS-REMOVED]: 근무 캘린더 파트 필터 탭 제거 확인', async ({ page }) => {
    // T-20260630-foot-HANDOVER-PARTSONLY-TOTAL-ATTEND-MONO 가 파트 필터 탭(handover-part-*)을 전면 제거 → 부재 단언으로 forward-update.
    await page.goto('/admin/handover');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="handover-part-filter"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="handover-part-therapist"]')).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: '직원 근무 캘린더' }),
    ).toBeVisible({ timeout: 15_000 });

    await page.screenshot({
      path: 'evidence/T-20260615-foot-THEME-MONO-REFINE-3AREA_AC3-therapist-tab.png',
      fullPage: true,
    });
  });
});
