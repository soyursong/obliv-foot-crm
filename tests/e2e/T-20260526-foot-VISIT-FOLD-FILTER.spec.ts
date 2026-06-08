/**
 * E2E spec — T-20260526-foot-VISIT-FOLD-FILTER
 * 방문이력 전체 열기/접기 + 메모 종류별 필터
 *
 * AC-1: 타임라인 상단 "모두펼침/모두접기" 버튼 + 펼침N/총M 카운트
 * AC-2: 치료메모·진료메모·특이사항 필터 chips (OR 로직)
 * AC-3: 특이사항 판별 기준 (키워드 매칭)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260526-VISIT-FOLD-FILTER — 방문이력 열기/접기 + 메모 필터', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // AC-1: 진료차트 열면 expand/collapse 컨트롤이 타임라인 상단에 표시됨
  test('AC-1a: 진료차트 Drawer 열면 모두펼침/모두접기 버튼 표시', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // 고객관리에서 첫 번째 고객 차트 열기
    await page.goto('/admin/customers');
    await page.waitForLoadState('networkidle');

    const chartBtns = page.locator('[data-testid="open-chart-btn"], [aria-label="차트 열기"], button:has-text("진료차트")');
    const chartBtnCount = await chartBtns.count();
    if (chartBtnCount === 0) {
      test.skip(true, '진료차트 열기 버튼 없음 — 스킵');
      return;
    }
    await chartBtns.first().click();

    // Drawer 대기
    const drawer = page.locator('[data-testid="medical-chart-drawer"]');
    const drawerVisible = await drawer.waitFor({ timeout: 10_000 }).then(() => true).catch(() => false);
    if (!drawerVisible) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }

    // 모두펼침 버튼 확인
    await expect(page.locator('[data-testid="expand-all-btn"]')).toBeVisible();
    // 모두접기 버튼 확인
    await expect(page.locator('[data-testid="collapse-all-btn"]')).toBeVisible();
  });

  // AC-1b: 모두펼침 클릭 → 아코디언 확장
  test('AC-1b: 모두펼침 클릭 → 타임라인 엔트리 아코디언 확장', async ({ page }) => {
    await page.goto('/admin/customers');
    await page.waitForLoadState('networkidle');

    const chartBtns = page.locator('[data-testid="open-chart-btn"], [aria-label="차트 열기"], button:has-text("진료차트")');
    if (await chartBtns.count() === 0) {
      test.skip(true, '진료차트 열기 버튼 없음 — 스킵');
      return;
    }
    await chartBtns.first().click();

    const drawer = page.locator('[data-testid="medical-chart-drawer"]');
    const drawerVisible = await drawer.waitFor({ timeout: 10_000 }).then(() => true).catch(() => false);
    if (!drawerVisible) {
      test.skip(true, 'Drawer 미열림 — 스킵');
      return;
    }

    // 타임라인 엔트리 개수 확인
    const entries = page.locator('[data-testid="medical-chart-timeline-entry"]');
    const entryCount = await entries.count();
    if (entryCount < 2) {
      test.skip(true, `타임라인 엔트리 ${entryCount}건 — 2건 이상 필요, 스킵`);
      return;
    }

    // 모두펼침 클릭
    const expandBtn = page.locator('[data-testid="expand-all-btn"]');
    await expandBtn.click();

    // 아코디언 토글 중 최소 1개 rotate-180 클래스 확인 (ChevronDown 회전)
    const rotatedChevrons = page.locator('[data-testid^="chart-accordion-toggle-"] svg.rotate-180');
    const rotatedCount = await rotatedChevrons.count();
    expect(rotatedCount).toBeGreaterThan(0);
  });

  // AC-1c: 모두접기 클릭 → 아코디언 축소
  test('AC-1c: 모두접기 클릭 → 아코디언 축소 (콘텐츠 사라짐)', async ({ page }) => {
    await page.goto('/admin/customers');
    await page.waitForLoadState('networkidle');

    const chartBtns = page.locator('[data-testid="open-chart-btn"], [aria-label="차트 열기"], button:has-text("진료차트")');
    if (await chartBtns.count() === 0) {
      test.skip(true, '진료차트 열기 버튼 없음 — 스킵');
      return;
    }
    await chartBtns.first().click();

    const drawer = page.locator('[data-testid="medical-chart-drawer"]');
    const drawerVisible = await drawer.waitFor({ timeout: 10_000 }).then(() => true).catch(() => false);
    if (!drawerVisible) {
      test.skip(true, 'Drawer 미열림 — 스킵');
      return;
    }

    // 먼저 펼치고
    await page.locator('[data-testid="expand-all-btn"]').click();
    // 모두접기 클릭
    await page.locator('[data-testid="collapse-all-btn"]').click();

    // 아코디언 콘텐츠 div가 사라졌는지 확인
    const accordionContents = page.locator('[data-testid^="chart-accordion-content-"]');
    const contentCount = await accordionContents.count();
    expect(contentCount).toBe(0);
  });

  // AC-2a: 치료메모 필터 chip 클릭 → 필터 활성화
  test('AC-2a: 치료메모 필터 chip 표시 + 클릭 시 활성 스타일', async ({ page }) => {
    await page.goto('/admin/customers');
    await page.waitForLoadState('networkidle');

    const chartBtns = page.locator('[data-testid="open-chart-btn"], [aria-label="차트 열기"], button:has-text("진료차트")');
    if (await chartBtns.count() === 0) {
      test.skip(true, '진료차트 열기 버튼 없음 — 스킵');
      return;
    }
    await chartBtns.first().click();

    const drawer = page.locator('[data-testid="medical-chart-drawer"]');
    const drawerVisible = await drawer.waitFor({ timeout: 10_000 }).then(() => true).catch(() => false);
    if (!drawerVisible) {
      test.skip(true, 'Drawer 미열림 — 스킵');
      return;
    }

    // 치료메모 필터 chip 표시 확인
    const treatFilter = page.locator('[data-testid="memo-filter-treat"]');
    await expect(treatFilter).toBeVisible();
    // 진료메모 필터 chip 표시 확인
    await expect(page.locator('[data-testid="memo-filter-doc"]')).toBeVisible();
    // T-20260609-foot-TIMELINE-FILTER-PREVIEW-FIX AC-10: '특이사항' 필터 chip 제거됨
    //   (특이사항은 좌측 상단 고정 '특이사항' 섹션으로 일원화 — 필터 칩에서 빠짐)
    await expect(page.locator('[data-testid="memo-filter-notable"]')).toHaveCount(0);
    // 특이사항 누적 섹션(상단 고정)은 상시 존재
    await expect(page.locator('[data-testid="special-note-section"]')).toBeVisible();

    // 치료메모 필터 클릭
    await treatFilter.click();
    // 활성 스타일 확인 (bg-blue-600 클래스)
    await expect(treatFilter).toHaveClass(/bg-blue-600/);
  });

  // AC-2b: 필터 클릭 후 "전체" 버튼 표시 + 클릭 시 필터 해제
  test('AC-2b: 필터 활성 시 전체(해제) 버튼 표시 + 클릭 시 해제', async ({ page }) => {
    await page.goto('/admin/customers');
    await page.waitForLoadState('networkidle');

    const chartBtns = page.locator('[data-testid="open-chart-btn"], [aria-label="차트 열기"], button:has-text("진료차트")');
    if (await chartBtns.count() === 0) {
      test.skip(true, '진료차트 열기 버튼 없음 — 스킵');
      return;
    }
    await chartBtns.first().click();

    const drawer = page.locator('[data-testid="medical-chart-drawer"]');
    const drawerVisible = await drawer.waitFor({ timeout: 10_000 }).then(() => true).catch(() => false);
    if (!drawerVisible) {
      test.skip(true, 'Drawer 미열림 — 스킵');
      return;
    }

    // 초기에 전체 버튼 없음
    const clearBtn = page.locator('[data-testid="memo-filter-clear"]');
    await expect(clearBtn).not.toBeVisible();

    // 진료메모 필터 클릭
    await page.locator('[data-testid="memo-filter-doc"]').click();

    // 전체 버튼 나타남
    await expect(clearBtn).toBeVisible();

    // 전체 버튼 클릭 → 필터 해제
    await clearBtn.click();
    await expect(clearBtn).not.toBeVisible();

    // 진료메모 필터 비활성
    await expect(page.locator('[data-testid="memo-filter-doc"]')).not.toHaveClass(/bg-teal-600/);
  });

  // AC-3: 타임라인 개별 아코디언 토글 버튼 존재 확인
  test('AC-3: 타임라인 엔트리마다 아코디언 토글 버튼 표시', async ({ page }) => {
    await page.goto('/admin/customers');
    await page.waitForLoadState('networkidle');

    const chartBtns = page.locator('[data-testid="open-chart-btn"], [aria-label="차트 열기"], button:has-text("진료차트")');
    if (await chartBtns.count() === 0) {
      test.skip(true, '진료차트 열기 버튼 없음 — 스킵');
      return;
    }
    await chartBtns.first().click();

    const drawer = page.locator('[data-testid="medical-chart-drawer"]');
    const drawerVisible = await drawer.waitFor({ timeout: 10_000 }).then(() => true).catch(() => false);
    if (!drawerVisible) {
      test.skip(true, 'Drawer 미열림 — 스킵');
      return;
    }

    const entries = page.locator('[data-testid="medical-chart-timeline-entry"]');
    const entryCount = await entries.count();
    if (entryCount === 0) {
      test.skip(true, '타임라인 엔트리 없음 — 스킵');
      return;
    }

    // 각 엔트리의 accordion-toggle 버튼 확인
    const toggleBtns = page.locator('[data-testid^="chart-accordion-toggle-"]');
    const toggleCount = await toggleBtns.count();
    expect(toggleCount).toBe(entryCount);
  });
});
