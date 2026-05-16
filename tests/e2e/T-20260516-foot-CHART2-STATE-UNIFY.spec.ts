/**
 * T-20260516-foot-CHART2-STATE-UNIFY — 2번차트 열림 state 단일화 (구조 리팩터)
 *
 * 배경: 2번차트(CustomerChartSheet) 열림이 3개 분산 state로 표현되어
 *   CHART2-REOPEN 9차+ 재발. AdminLayout 레벨 단일 ChartContext로 통합.
 *
 * AC-1: AdminLayout ChartContext 단일 소스 (dashChartSheetId·chartSheetId·chart2Id 제거)
 * AC-2: CustomerChartSheet 렌더 AdminLayout 1곳으로 단일화 (4곳 중복 제거)
 * AC-3: z-index 체계화 (z-[60]/z-[70] zLevel=1 대응)
 * AC-4: 4경로(Dashboard/CheckInDetail/Customers/URL) 회귀 0
 *
 * ⚠️ E2E 계정 의존: T-20260516-infra-FOOT-E2E-ACCOUNT 완료 후 실브라우저 검증 가능.
 *   auth.setup.ts 없으면 authenticated 시나리오는 skip.
 */

import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8082';

/**
 * 시나리오 1: 4경로 순차 열기
 * Dashboard → CheckInDetail → Customers → URL 직접
 * 모두 ChartContext를 통해 단일 CustomerChartSheet를 열어야 함
 */
test.describe('T-20260516-foot-CHART2-STATE-UNIFY — 4경로 2번차트 단일 소스', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/admin`);
    await page.waitForLoadState('networkidle');
  });

  // ── 시나리오 1-A: Dashboard 칸반 → 2번차트 ────────────────────────────────
  test('AC-4 경로1: Dashboard 컨텍스트메뉴 [고객차트] → CustomerChartSheet 열림', async ({ page }) => {
    // 칸반 카드 중 우클릭 가능한 카드 탐색
    const card = page.locator('[data-testid="kanban-card"]').first();
    if (await card.count() === 0) {
      test.skip(); // 오늘 체크인 없으면 skip
      return;
    }

    // 우클릭 → 컨텍스트메뉴
    await card.click({ button: 'right' });
    const ctxMenu = page.locator('[data-testid="customer-quick-menu"]');
    await expect(ctxMenu).toBeVisible({ timeout: 5000 });

    // [고객차트] 메뉴 항목 클릭
    const chartBtn = ctxMenu.getByRole('button', { name: /고객차트/ });
    await expect(chartBtn).toBeVisible({ timeout: 3000 });
    await chartBtn.click();

    // CustomerChartSheet — createPortal fixed right-0 top-0 패널 열림 확인
    // z-[70] 패널: role=dialog, aria-label="고객차트"
    const chartPanel = page.getByRole('dialog', { name: '고객차트' });
    await expect(chartPanel).toBeVisible({ timeout: 8000 });
  });

  // ── 시나리오 1-B: CheckInDetail → [고객차트] → 2번차트 ───────────────────
  test('AC-4 경로2: CheckInDetailSheet [고객차트보기] → CustomerChartSheet 열림', async ({ page }) => {
    const card = page.locator('[data-testid="timeline-checkin-card"]').first();
    if (await card.count() === 0) {
      test.skip();
      return;
    }
    await card.click();

    // 1번차트(CheckInDetailSheet) 열림
    const sheet1 = page.getByRole('dialog').filter({ hasText: /고객차트/ }).first();
    await expect(sheet1).toBeVisible({ timeout: 8000 });

    // [고객차트] 또는 [고객차트보기] 버튼
    const openChartBtn = sheet1.getByRole('button', { name: /고객차트/ }).first();
    await expect(openChartBtn).toBeVisible({ timeout: 5000 });
    await openChartBtn.click();

    // 2번차트(CustomerChartSheet) 열림 — role=dialog aria-label="고객차트"
    const chartPanel = page.getByRole('dialog', { name: '고객차트' });
    await expect(chartPanel).toBeVisible({ timeout: 8000 });
  });

  // ── 시나리오 1-C: Customers 목록 → 2번차트 ──────────────────────────────
  test('AC-4 경로3: 고객관리 목록 클릭 → CustomerChartSheet 열림', async ({ page }) => {
    await page.goto(`${BASE}/admin/customers`);
    await page.waitForLoadState('networkidle');

    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.count() === 0) {
      test.skip();
      return;
    }
    await firstRow.click();

    // CustomerChartSheet 열림
    const chartPanel = page.getByRole('dialog', { name: '고객차트' });
    await expect(chartPanel).toBeVisible({ timeout: 8000 });
  });

  // ── 시나리오 2: 환자 전환 시 stale 없음 ─────────────────────────────────
  test('AC-4 시나리오2: 환자 A→B 전환 시 stale 차트 없음', async ({ page }) => {
    // Customers 목록에서 두 환자 순차 클릭 → 각각 다른 차트 표시
    await page.goto(`${BASE}/admin/customers`);
    await page.waitForLoadState('networkidle');

    const rows = page.locator('table tbody tr');
    if (await rows.count() < 2) {
      test.skip();
      return;
    }

    // 환자 A 클릭
    await rows.first().click();
    const chartA = page.getByRole('dialog', { name: '고객차트' });
    await expect(chartA).toBeVisible({ timeout: 8000 });

    // X 닫기 → 환자 B 클릭
    const closeBtn = chartA.getByRole('button', { name: '닫기' });
    await closeBtn.click();
    await expect(chartA).toBeHidden({ timeout: 3000 });

    await rows.nth(1).click();
    const chartB = page.getByRole('dialog', { name: '고객차트' });
    await expect(chartB).toBeVisible({ timeout: 8000 });

    // B 패널에 A 환자 잔존 없음 — 두 다른 패널이 동시에 열리지 않음
    await expect(page.getByRole('dialog', { name: '고객차트' })).toHaveCount(1);
  });

  // ── 시나리오 3: 중첩 z-index ─────────────────────────────────────────────
  test('AC-3 시나리오3: CheckInDetailSheet 위에 CustomerChartSheet 정상 표시', async ({ page }) => {
    // 1번차트 열기
    const card = page.locator('[data-testid="timeline-checkin-card"]').first();
    if (await card.count() === 0) {
      test.skip();
      return;
    }
    await card.click();

    const sheet1 = page.getByRole('dialog').filter({ hasText: /고객차트/ }).first();
    await expect(sheet1).toBeVisible({ timeout: 8000 });

    // 1번차트 열린 상태에서 2번차트 열기
    const openChartBtn = sheet1.getByRole('button', { name: /고객차트/ }).first();
    await expect(openChartBtn).toBeVisible({ timeout: 5000 });
    await openChartBtn.click();

    // 2번차트가 위에 표시되어야 함 (z-[70] > z-50)
    const chartPanel = page.getByRole('dialog', { name: '고객차트' });
    await expect(chartPanel).toBeVisible({ timeout: 8000 });

    // 2번차트 닫기 → 1번차트 여전히 열려 있어야 함
    const closeBtn = chartPanel.getByRole('button', { name: '닫기' });
    await closeBtn.click();
    await expect(chartPanel).toBeHidden({ timeout: 3000 });

    // 1번차트 여전히 열림
    await expect(sheet1).toBeVisible({ timeout: 3000 });
  });

  // ── AC-1/AC-2 구조 검증: CustomerChartSheet 인스턴스 1개만 ──────────────
  test('AC-2: CustomerChartSheet가 DOM에 최대 1개 렌더됨 (중복 없음)', async ({ page }) => {
    // 2번차트 열기 (Customers 경로)
    await page.goto(`${BASE}/admin/customers`);
    await page.waitForLoadState('networkidle');

    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.count() === 0) {
      test.skip();
      return;
    }
    await firstRow.click();

    const chartPanel = page.getByRole('dialog', { name: '고객차트' });
    await expect(chartPanel).toBeVisible({ timeout: 8000 });

    // role=dialog aria-label="고객차트"가 정확히 1개만 존재
    await expect(page.getByRole('dialog', { name: '고객차트' })).toHaveCount(1);
  });
});
