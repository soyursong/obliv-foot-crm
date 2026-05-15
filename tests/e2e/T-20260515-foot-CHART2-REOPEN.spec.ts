/**
 * T-20260515-foot-CHART2-REOPEN
 * 2번차트 열기 버그 재발 — hotfix 검증
 *
 * Root cause: handleTimelineCardClick이 Dashboard 레벨에서 dashChartSheetId(z-70)를
 *   CheckInDetailSheet(z-50)와 동시 열어 z-index 충돌 → 2번차트 열기 경로 파괴.
 * Fix: handleTimelineCardClick 제거 → handleCardClick 복구.
 *      초진 자동 열기는 CheckInDetailSheet 내부 chartSheetId(useEffect) 재구현.
 *
 * AC-1: Dashboard 타임라인 카드 클릭 → 1번차트(CheckInDetailSheet) 정상 열림
 * AC-2: 1번차트 내 "고객차트보기" 클릭 → 2번차트(CustomerChartSheet) 정상 열림
 * AC-3: 초진 카드 클릭 → 2번차트 자동 오픈 (INITIAL-CHART-OPEN 보존)
 * AC-4: 전 경로(Dashboard/CheckInDetail/Customers/URL) 2번차트 열기 동작
 */

import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

test.describe('T-20260515-foot-CHART2-REOPEN — 2번차트 열기 복구', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/admin`);
    await page.waitForLoadState('networkidle');
  });

  // ── AC-1: 타임라인 카드 클릭 → 1번차트 열림 ──────────────────────────────
  test('AC-1: 타임라인 카드 클릭 시 CheckInDetailSheet(1번차트) 열림', async ({ page }) => {
    // 타임라인 섹션 대기
    const timeline = page.locator('[data-testid="timeline-slot-new"], [data-testid="timeline-slot-ret"]').first();
    await expect(timeline).toBeVisible({ timeout: 10000 });

    // 체크인 카드 클릭
    const card = page.locator('[data-testid="timeline-checkin-card"]').first();
    if (await card.count() === 0) {
      test.skip(); // 오늘 타임라인 데이터 없으면 skip
      return;
    }
    await card.click();

    // CheckInDetailSheet(1번차트) 열림 확인 — 버튼 텍스트 "고객차트" (MEDICAL-CHART-V1 이후)
    const sheet = page.getByRole('dialog').filter({ hasText: /고객차트/ });
    await expect(sheet).toBeVisible({ timeout: 5000 });
  });

  // ── AC-2: 1번차트 내 "고객차트보기" → 2번차트 열림 ──────────────────────
  test('AC-2: CheckInDetailSheet "고객차트보기" 클릭 → CustomerChartSheet 열림', async ({ page }) => {
    const card = page.locator('[data-testid="timeline-checkin-card"]').first();
    if (await card.count() === 0) {
      test.skip();
      return;
    }
    await card.click();

    // 1번차트 열림 대기 — "고객차트" 버튼 (MEDICAL-CHART-V1 이후 "고객차트보기" → "고객차트")
    const openChartBtn = page.getByRole('button', { name: '고객차트' });
    await expect(openChartBtn).toBeVisible({ timeout: 5000 });
    await openChartBtn.click();

    // 2번차트(CustomerChartSheet) — createPortal z-[70] 패널 열림 확인
    // CustomerChartSheet는 fixed right-0 top-0 패널이므로 data-testid 없이 위치로 확인
    const chartPanel = page.locator('.fixed.right-0.top-0').filter({ hasText: /차트/ }).first();
    await expect(chartPanel).toBeVisible({ timeout: 5000 });
  });

  // ── AC-3: 초진 카드 → 2번차트 자동 오픈 (INITIAL-CHART-OPEN 보존) ───────
  test('AC-3: 초진(new) 타임라인 카드 → 2번차트 자동 열림', async ({ page }) => {
    // 초진 슬롯 카드만 필터 (visit_type=new인 TimelineCheckInCard)
    // data-testid="timeline-checkin-card"는 모든 체크인 카드에 공통 → 초진 박스는 초진컬럼에 있음
    const newSlotCard = page
      .locator('[data-testid="timeline-slot-new"] [data-testid="timeline-checkin-card"]')
      .first();
    if (await newSlotCard.count() === 0) {
      test.skip();
      return;
    }
    await newSlotCard.click();

    // 초진 카드 클릭 → CheckInDetailSheet 열림 + 2번차트 자동 열림
    // 2번차트는 CheckInDetailSheet 내 chartSheetId useEffect로 자동 오픈
    const chartPanel = page.locator('.fixed.right-0.top-0').first();
    await expect(chartPanel).toBeVisible({ timeout: 6000 });
  });

  // ── AC-4: Customers 목록에서 2번차트 열기 ────────────────────────────────
  test('AC-4: Customers 목록 → 차트보기 → 2번차트 열림', async ({ page }) => {
    await page.goto(`${BASE}/admin/customers`);
    await page.waitForLoadState('networkidle');

    // 첫 번째 고객 row에서 차트보기 버튼
    const chartBtn = page.getByRole('button', { name: /차트보기|고객차트/ }).first();
    if (await chartBtn.count() === 0) {
      test.skip();
      return;
    }
    await chartBtn.click();

    // CustomerChartSheet 열림 확인
    const chartPanel = page.locator('.fixed.right-0.top-0').first();
    await expect(chartPanel).toBeVisible({ timeout: 5000 });
  });

  // ── 회귀: Dashboard CustomerChartSheet와 CheckInDetailSheet 동시 열기 없음 ──
  test('REGRESSION: 타임라인 카드 클릭 시 dashChartSheetId 중복 오픈 없음', async ({ page }) => {
    const card = page.locator('[data-testid="timeline-checkin-card"]').first();
    if (await card.count() === 0) {
      test.skip();
      return;
    }
    await card.click();

    // z-[70] CustomerChartSheet가 2개 이상 동시에 열리면 안됨 (Dashboard 레벨 + Sheet 레벨 중복 방지)
    const chartPanels = page.locator('.fixed.right-0.top-0');
    const count = await chartPanels.count();
    // 초진이면 1개(자동), 재진이면 0개(수동 열기 전)
    expect(count).toBeLessThanOrEqual(1);
  });
});
