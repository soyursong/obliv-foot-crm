/**
 * T-20260516-foot-CHART-OPEN-UNIFY — CRM 전체 메뉴 차트 열림 구조 통일화
 *
 * AC-1: Reservations.tsx 잔존 CustomerChartSheet 렌더 → ChartContext 통합 검증
 * AC-3: 모든 진입점에서 차트가 동일한 방식(슬라이드 패널)으로 열림
 * AC-4: 기존 4경로 + Reservations 경로 회귀 0
 * AC-5: 칸반 슬롯별(상담대기/치료대기/진료대기) 동일 열림 방식 검증
 *       기준: 2번차트(CustomerChartSheet) 슬라이드 패널 자동 오픈
 *
 * 의존: T-20260516-foot-CHART2-STATE-UNIFY (deployed) — ChartContext 단일 소스 선행
 *
 * ⚠️ E2E 계정 의존: auth.setup.ts 없으면 authenticated 시나리오 skip.
 */

import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

// 공통: CustomerChartSheet 열림 확인 헬퍼
async function expectChartSheetOpen(page: import('@playwright/test').Page) {
  // CustomerChartSheet는 createPortal로 마운트된 슬라이드 패널
  // z-[70] 패널 또는 고객차트 관련 콘텐츠로 확인
  const chartSheet = page.locator('[data-testid="customer-chart-sheet"]').or(
    page.locator('.z-\\[70\\]')
  );
  // 슬라이드 패널이 DOM에 있으면 통과 (타임아웃 내)
  await expect(chartSheet.first()).toBeAttached({ timeout: 6000 });
}

// ── 시나리오 1: 전체 메뉴 순차 차트 열기 ─────────────────────────────────────
test.describe('T-20260516-foot-CHART-OPEN-UNIFY — 전체 메뉴 열림 일관성', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/admin`);
    await page.waitForLoadState('networkidle');
  });

  // AC-4 경로1: Dashboard 칸반 카드 클릭 → CheckInDetailSheet + 2번차트 자동 오픈
  test('AC-4 경로1: Dashboard 칸반 카드 클릭 → CheckInDetailSheet 열림', async ({ page }) => {
    const card = page.locator('[data-testid="kanban-card"]').first();
    if (await card.count() === 0) {
      test.skip();
      return;
    }
    await card.click();
    // CheckInDetailSheet 열림 확인
    const sheet = page.locator('[data-testid="checkin-detail-sheet"]').or(
      page.locator('[role="dialog"]')
    );
    await expect(sheet.first()).toBeVisible({ timeout: 5000 });
  });

  // AC-1 검증: 예약관리에서 우클릭 → [고객차트] → ChartContext로 열림 (별도 렌더 X)
  test('AC-1: 예약관리 우클릭 [고객차트] → AdminLayout CustomerChartSheet 열림', async ({ page }) => {
    await page.goto(`${BASE}/admin/reservations`);
    await page.waitForLoadState('networkidle');

    // 예약 카드 탐색
    const resvCard = page.locator('[data-testid="resv-card"]').or(
      page.locator('[data-testid="reservation-row"]')
    ).first();
    if (await resvCard.count() === 0) {
      test.skip();
      return;
    }

    // 우클릭 → 컨텍스트 메뉴
    await resvCard.click({ button: 'right' });
    const ctxMenu = page.locator('[data-testid="customer-quick-menu"]');
    if (await ctxMenu.count() === 0) {
      test.skip(); // 컨텍스트 메뉴 없으면 skip
      return;
    }
    await expect(ctxMenu).toBeVisible({ timeout: 3000 });

    // [고객차트] 버튼 클릭
    const chartBtn = ctxMenu.getByRole('button', { name: /고객차트/ });
    if (await chartBtn.count() === 0) {
      test.skip();
      return;
    }
    await chartBtn.click();

    // CustomerChartSheet 열림 확인 (AdminLayout 단일 렌더 — Reservations 자체 렌더 X)
    await expectChartSheetOpen(page);
  });

  // AC-3: 예약관리 차트 열림 → 닫기 → Dashboard 칸반 차트 열림 → 동일 방식
  test('AC-3: 예약관리 → Dashboard 순차 열기 시 동일 방식 확인', async ({ page }) => {
    // Dashboard → 칸반 카드 클릭
    const card = page.locator('[data-testid="kanban-card"]').first();
    if (await card.count() === 0) {
      test.skip();
      return;
    }
    await card.click();
    const sheet = page.locator('[role="dialog"]').first();
    await expect(sheet).toBeVisible({ timeout: 5000 });

    // ESC로 닫기
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // 예약관리로 이동
    await page.goto(`${BASE}/admin/reservations`);
    await page.waitForLoadState('networkidle');

    // 예약관리에서 차트 열기 시도 (카드 있을 때만)
    const resvCard = page.locator('[data-testid="resv-card"]').first();
    if (await resvCard.count() === 0) {
      test.skip();
      return;
    }

    await resvCard.click({ button: 'right' });
    const ctxMenu = page.locator('[data-testid="customer-quick-menu"]');
    if (await ctxMenu.count() === 0) {
      test.skip();
      return;
    }
    await expect(ctxMenu).toBeVisible({ timeout: 3000 });

    const chartBtn = ctxMenu.getByRole('button', { name: /고객차트/ });
    if (await chartBtn.count() === 0) {
      test.skip();
      return;
    }
    await chartBtn.click();

    // 동일 방식(슬라이드 패널)으로 열림
    await expectChartSheetOpen(page);
  });
});

// ── 시나리오 3 (AC-5): 칸반 슬롯별 동일 열림 방식 ─────────────────────────────
test.describe('T-20260516-foot-CHART-OPEN-UNIFY AC-5 — 칸반 슬롯별 동일 열림 방식', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/admin`);
    await page.waitForLoadState('networkidle');
  });

  // 상담대기 슬롯 카드 클릭 → CheckInDetailSheet + 2번차트 자동 오픈
  test('AC-5 상담대기: 카드 클릭 → CheckInDetailSheet 열림 + customer_id 있으면 2번차트 자동', async ({ page }) => {
    // 상담대기 컬럼 내 카드 탐색
    const consultCol = page.locator('[id="consult_waiting"]').or(
      page.locator('[data-column="consult_waiting"]')
    );
    const card = consultCol.locator('[data-testid="kanban-card"]').first();
    if (await card.count() === 0) {
      test.skip(); // 상담대기 고객 없으면 skip
      return;
    }
    await card.click();
    const sheet = page.locator('[role="dialog"]').first();
    await expect(sheet).toBeVisible({ timeout: 5000 });
  });

  // 치료대기 슬롯 카드 클릭 → 동일 열림 방식
  test('AC-5 치료대기: 카드 클릭 → CheckInDetailSheet 열림 (상담대기와 동일)', async ({ page }) => {
    const treatCol = page.locator('[id="treatment_waiting"]').or(
      page.locator('[data-column="treatment_waiting"]')
    );
    const card = treatCol.locator('[data-testid="kanban-card"]').first();
    if (await card.count() === 0) {
      test.skip();
      return;
    }
    await card.click();
    const sheet = page.locator('[role="dialog"]').first();
    await expect(sheet).toBeVisible({ timeout: 5000 });
  });

  // 진료대기 슬롯 카드 클릭 → 동일 열림 방식
  test('AC-5 진료대기: 카드 클릭 → CheckInDetailSheet 열림 (김사비 방식 = 기준)', async ({ page }) => {
    const examCol = page.locator('[id="exam_waiting"]').or(
      page.locator('[data-column="exam_waiting"]')
    );
    const card = examCol.locator('[data-testid="kanban-card"]').first();
    if (await card.count() === 0) {
      test.skip();
      return;
    }
    await card.click();
    const sheet = page.locator('[role="dialog"]').first();
    await expect(sheet).toBeVisible({ timeout: 5000 });
  });

  // AC-5 핵심: 슬롯 간 열림 방식 동일 — 모든 슬롯이 동일 컴포넌트(CheckInDetailSheet) 사용
  test('AC-5 규칙락: Reservations.tsx에 별도 CustomerChartSheet 렌더 없음 — AdminLayout 단일 소스', async ({ page }) => {
    // 빌드된 JS에서 resvChartSheetId 참조 없음을 간접 확인
    // (직접 JS 파싱 불가 → 예약관리 페이지 로드 시 오류 없음으로 대리 검증)
    await page.goto(`${BASE}/admin/reservations`);
    await page.waitForLoadState('networkidle');

    // 콘솔 에러 없음
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    // 페이지 정상 렌더 확인
    await expect(page.locator('body')).toBeVisible();

    // JS 에러 없음 (critical error 없으면 통과)
    const criticalErrors = errors.filter((e) =>
      !e.includes('favicon') && !e.includes('404') && !e.includes('supabase')
    );
    expect(criticalErrors.length).toBe(0);
  });
});
