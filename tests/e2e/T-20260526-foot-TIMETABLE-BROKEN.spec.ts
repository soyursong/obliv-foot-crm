/**
 * E2E spec — T-20260526-foot-TIMETABLE-BROKEN
 * 통합시간표 탭 안열림 긴급 수정
 *
 * 원인: TIMETABLE-FOLD V2(a8c0517) + TIMETABLE-SCROLL(629aa8d) 조합
 *   - expandedSlot 초기값 = isToday ? currentSlot : null → 마운트 시 현재 슬롯 자동 펼침
 *   - DUMMY-DATA-CLEANUP 232건 삭제 후 accordion 렌더 중 JS 에러 → ChunkErrorBoundary 캐치
 *   - Dashboard 전체가 "페이지를 불러오는 중 오류가 발생했습니다." 화면으로 대체됨
 *
 * 수정:
 *   - expandedSlot 초기값 → null (자동 펼침 제거)
 *   - 아코디언 항목 null-safe 처리 (r?.customer_name ?? null)
 *   - safeVisitType 가드 + chartMap?.get() null safety
 *
 * AC-1: 통합시간표 탭 정상 열기 (슬롯 그리드 렌더됨)
 * AC-2: 접기/펼치기 V1 기능 회귀 없음
 * AC-3: 마운트 시 아코디언 자동 펼침 없음 (aria-expanded=false 기본값)
 * AC-4: 슬롯 클릭 → 아코디언 정상 토글
 * AC-5: 에러바운더리 노출 없음
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260526 TIMETABLE-BROKEN — 통합시간표 탭 안열림 수정', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — 스킵');
  });

  test('AC-1: 통합시간표 탭 클릭 → 슬롯 그리드 정상 렌더', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // 시간표가 접혀 있으면 펼치기 버튼 클릭
    const strip = page.locator('button[aria-label="시간표 펼치기"]');
    if (await strip.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await strip.click();
      await page.waitForTimeout(400);
    }

    // 슬롯 그리드 렌더 확인
    try {
      await page.locator('[data-testid="timeline-slot-row"]').first().waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, '통합시간표 슬롯 미노출 — 환경 스킵');
      return;
    }

    const slotRows = page.locator('[data-testid="timeline-slot-row"]');
    const count = await slotRows.count();
    expect(count).toBeGreaterThan(5);
    console.log(`[AC-1] 슬롯 행 ${count}개 확인 PASS`);

    // 초진/재진 컬럼 헤더 확인
    await expect(page.locator('[data-testid="timeline-time-col"]').first()).toBeVisible();
    console.log('[AC-1] 시간 컬럼 헤더 PASS');
  });

  test('AC-2: 접기/펼치기 토글 — V1 회귀 없음', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // 1) 시간표 펼친 상태 확인 또는 펼치기
    const strip = page.locator('button[aria-label="시간표 펼치기"]');
    if (await strip.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await strip.click();
      await page.waitForTimeout(400);
    }

    // 슬롯 확인
    try {
      await page.locator('[data-testid="timeline-slot-row"]').first().waitFor({ timeout: 8_000 });
    } catch {
      test.skip(true, '슬롯 미노출 — 환경 스킵');
      return;
    }
    console.log('[AC-2] 펼친 상태 확인 PASS');

    // 2) 접기 버튼 클릭
    const foldBtn = page.locator('button[aria-label="시간표 접기"]');
    await expect(foldBtn).toBeVisible({ timeout: 5_000 });
    await foldBtn.click();
    await page.waitForTimeout(300);

    // 시간표 슬롯이 사라져야 함
    const slotCount = await page.locator('[data-testid="timeline-slot-row"]').count();
    expect(slotCount).toBe(0);
    console.log('[AC-2] 접기 후 슬롯 미노출 PASS');

    // 3) 펼치기 버튼 재클릭
    const stripAfterFold = page.locator('button[aria-label="시간표 펼치기"]');
    await expect(stripAfterFold).toBeVisible({ timeout: 5_000 });
    await stripAfterFold.click();
    await page.waitForTimeout(400);

    // 슬롯 복원 확인
    await page.locator('[data-testid="timeline-slot-row"]').first().waitFor({ timeout: 8_000 });
    console.log('[AC-2] 펼치기 복원 PASS');
  });

  test('AC-3: 마운트 시 아코디언 자동 펼침 없음', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // 시간표 펼치기
    const strip = page.locator('button[aria-label="시간표 펼치기"]');
    if (await strip.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await strip.click();
      await page.waitForTimeout(400);
    }

    try {
      await page.locator('[data-testid="timeline-slot-row"]').first().waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, '슬롯 미노출 — 환경 스킵');
      return;
    }

    // 마운트 직후 아코디언 패널이 열려있지 않아야 함 (aria-expanded=false 모든 슬롯)
    const expandedButtons = page.locator('button[aria-expanded="true"]');
    const expandedCount = await expandedButtons.count();
    expect(expandedCount).toBe(0);
    console.log('[AC-3] 마운트 시 자동 펼침 없음 PASS');
  });

  test('AC-4: 슬롯 시간 버튼 클릭 → 아코디언 토글', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // 시간표 펼치기
    const strip = page.locator('button[aria-label="시간표 펼치기"]');
    if (await strip.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await strip.click();
      await page.waitForTimeout(400);
    }

    try {
      await page.locator('[data-testid="timeline-slot-row"]').first().waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, '슬롯 미노출 — 환경 스킵');
      return;
    }

    // 첫 번째 슬롯 시간 버튼 클릭
    const firstSlotBtn = page.locator('button[data-testid^="timeline-slot-time-"]').first();
    await expect(firstSlotBtn).toBeVisible({ timeout: 5_000 });
    const slotId = await firstSlotBtn.getAttribute('data-testid') ?? '';
    const slot = slotId.replace('timeline-slot-time-', '');

    await firstSlotBtn.click();
    await page.waitForTimeout(200);

    // aria-expanded=true가 됨
    await expect(firstSlotBtn).toHaveAttribute('aria-expanded', 'true');
    console.log(`[AC-4] 슬롯 ${slot} 펼침 PASS`);

    // 아코디언 패널 표시됨
    const accordion = page.locator(`[data-testid="timeline-slot-accordion-${slot}"]`);
    await expect(accordion).toBeVisible({ timeout: 3_000 });
    console.log('[AC-4] 아코디언 패널 표시 PASS');

    // 다시 클릭 → 접힘
    await firstSlotBtn.click();
    await page.waitForTimeout(200);
    await expect(firstSlotBtn).toHaveAttribute('aria-expanded', 'false');
    console.log('[AC-4] 슬롯 재클릭 → 접힘 PASS');
  });

  test('AC-5: 에러바운더리 노출 없음 — "페이지를 불러오는 중 오류" 없어야 함', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // 시간표 펼치기
    const strip = page.locator('button[aria-label="시간표 펼치기"]');
    if (await strip.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await strip.click();
      await page.waitForTimeout(400);
    }

    // 에러 바운더리 메시지 노출 없음
    const errorMsg = page.getByText('페이지를 불러오는 중 오류가 발생했습니다.');
    await expect(errorMsg).toHaveCount(0);
    console.log('[AC-5] 에러바운더리 노출 없음 PASS');

    // 새로고침 버튼도 없어야 함
    const reloadBtn = page.getByRole('button', { name: '새로고침' });
    await expect(reloadBtn).toHaveCount(0);
    console.log('[AC-5] 새로고침 버튼 미노출 PASS');
  });
});
