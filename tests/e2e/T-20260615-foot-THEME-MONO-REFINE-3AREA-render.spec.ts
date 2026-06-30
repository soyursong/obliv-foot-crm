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

  test('AC3[SUPERSEDED→MONO]: 근무 캘린더 치료사 탭 — 미선택 무채색(slate)·선택 green 렌더', async ({ page }) => {
    await page.goto('/admin/handover');
    await page.waitForLoadState('networkidle');
    const therapistTab = page.locator('[data-testid="handover-part-therapist"]').first();
    await expect(therapistTab).toBeVisible({ timeout: 15_000 });
    // T-20260630-foot-HANDOVER-BOX-COMPACT-MONO (김주연 총괄 자기-override, AC2 배지 무채색화):
    //   미선택 필터 칩은 card 배지와 partBadgeClass 를 공유 → 전 파트 무채색(slate-200) 통일.
    //   직전 3AREA AC3 의 '미선택 치료사 탭 green' 단언을 무채색 단언으로 forward-update.
    //   (선택 상태 green·출근자 칩·통합시간표 색은 범위 밖·불변.)
    const cls = await therapistTab.getAttribute('class');
    expect(cls ?? '').toMatch(/slate/);
    expect(cls ?? '').not.toMatch(/green/);

    // T-20260615-foot-MONOTONE-…-THERAPISTGREEN item3(불변): 선택 상태 실렌더 검증 —
    //   클릭 후 배경이 brown(teal-600 리맵 #6E6353)이 아닌 green 이어야 한다(리포터 누수 경로).
    await therapistTab.click();
    await expect(therapistTab).toHaveClass(/bg-green-600/);
    const selBg = await therapistTab.evaluate((el) => getComputedStyle(el).backgroundColor);
    // warm-brown 리맵 RGB(110,99,83)=#6E6353 이 아니어야 함
    expect(selBg).not.toBe('rgb(110, 99, 83)');

    await page.screenshot({
      path: 'evidence/T-20260615-foot-THEME-MONO-REFINE-3AREA_AC3-therapist-tab.png',
      fullPage: true,
    });
  });
});
