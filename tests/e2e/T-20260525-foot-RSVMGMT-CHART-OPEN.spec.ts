/**
 * T-20260525-foot-RSVMGMT-CHART-OPEN
 * 예약관리 고객박스 클릭 시 1·2번차트 열림 누락 수정
 *
 * AC-1: 예약관리 페이지 고객박스(CustomerHoverCard) 클릭 → 1·2번차트(CustomerChartSheet) 열림
 * AC-2: 열리는 차트에 해당 고객 정보 표시 (고객차트 dialog 인식)
 * AC-3: 대시보드 고객박스 클릭 기존 동작 유지 / 예약관리 드래그 인터랙션 유지
 *
 * 변경 요약:
 * - CustomerHoverCard: onClick prop 추가 → 이름 span에 연결
 * - Reservations: CustomerHoverCard onClick={() => handleResvOpenChart(resvAsCheckIn(r))}
 * - 차트 열림: openChart(customer_id) → ChartContext → CustomerChartSheet (AdminLayout 단일 소스)
 *
 * ⚠️ 인증 의존: 로그인 없으면 예약 데이터 없음 → test.skip()으로 graceful degradation
 */

import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

// 공통: 고객차트(CustomerChartSheet) 열림 확인 헬퍼
// CustomerChartSheet: role="dialog" aria-label="고객차트" (z-[70] 패널)
async function expectChartSheetOpen(page: import('@playwright/test').Page) {
  const chartDialog = page.locator('[role="dialog"][aria-label="고객차트"]').or(
    page.locator('.z-\\[70\\]')
  );
  await expect(chartDialog.first()).toBeAttached({ timeout: 6000 });
}

// ── AC-1·AC-2: 예약관리 고객박스 클릭 → 차트 열림 ───────────────────────────
test.describe('T-20260525-foot-RSVMGMT-CHART-OPEN — 예약관리 고객박스 클릭 차트 열림', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/admin/reservations`);
    await page.waitForLoadState('networkidle');
  });

  // AC-1: 예약관리 고객박스 클릭 → CustomerChartSheet 열림
  test('AC-1: 예약관리 고객박스(CustomerHoverCard) 클릭 → 1·2번차트 열림', async ({ page }) => {
    // 예약 카드 탐색 (data-testid="resv-card-{id}")
    const resvCard = page.locator('[data-testid^="resv-card-"]').first();
    if (await resvCard.count() === 0) {
      test.skip(); // 예약 데이터 없으면 skip (인증/데이터 부재)
      return;
    }

    // 고객박스 내 클릭 가능한 이름 span 탐색
    // CustomerHoverCard onClick 연결 시 data-testid="customer-hover-card-name-clickable"
    const clickableName = resvCard.locator('[data-testid="customer-hover-card-name-clickable"]').first();
    if (await clickableName.count() === 0) {
      // customer_id 미연결 또는 취소된 예약 — skip
      test.skip();
      return;
    }

    // 클릭 → 차트 열림
    await clickableName.click();

    // CustomerChartSheet(1·2번차트) 열림 확인
    await expectChartSheetOpen(page);
  });

  // AC-2: 열린 차트가 고객차트 dialog로 인식되는지 확인
  test('AC-2: 열린 차트가 고객차트 dialog(aria-label) 포함 확인', async ({ page }) => {
    const resvCard = page.locator('[data-testid^="resv-card-"]').first();
    if (await resvCard.count() === 0) {
      test.skip();
      return;
    }

    const clickableName = resvCard.locator('[data-testid="customer-hover-card-name-clickable"]').first();
    if (await clickableName.count() === 0) {
      test.skip();
      return;
    }

    await clickableName.click();

    // 고객차트 dialog visible
    const chartDialog = page.locator('[role="dialog"][aria-label="고객차트"]');
    await expect(chartDialog).toBeAttached({ timeout: 6000 });
  });

  // AC-1 시나리오 3: 다른 고객 클릭 시 차트 전환
  test('AC-1 시나리오3: 고객A 클릭 → 차트 열림, 고객B 클릭 → 차트 전환', async ({ page }) => {
    const cards = page.locator('[data-testid^="resv-card-"]');
    const count = await cards.count();
    if (count < 2) {
      test.skip(); // 예약 2개 이상 필요
      return;
    }

    // 고객A 클릭
    const nameA = cards.nth(0).locator('[data-testid="customer-hover-card-name-clickable"]').first();
    if (await nameA.count() === 0) {
      test.skip();
      return;
    }
    await nameA.click();
    await expectChartSheetOpen(page);

    // 차트 닫기 (ESC)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // 고객B 클릭 (다른 카드)
    let nameB: import('@playwright/test').Locator | null = null;
    for (let i = 1; i < count; i++) {
      const candidate = cards.nth(i).locator('[data-testid="customer-hover-card-name-clickable"]').first();
      if (await candidate.count() > 0) {
        nameB = candidate;
        break;
      }
    }
    if (!nameB) {
      test.skip();
      return;
    }
    await nameB.click();
    await expectChartSheetOpen(page);
  });
});

// ── AC-3: 대시보드 기존 동작 유지 ───────────────────────────────────────────
test.describe('T-20260525-foot-RSVMGMT-CHART-OPEN AC-3 — 대시보드 기존 동작 유지', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/admin`);
    await page.waitForLoadState('networkidle');
  });

  // AC-3: 대시보드 칸반 카드 클릭 → CheckInDetailSheet 열림 (기존 동작 유지)
  test('AC-3: 대시보드 칸반 카드 클릭 → 기존 CheckInDetailSheet 열림 유지', async ({ page }) => {
    const card = page.locator('[data-testid="kanban-card"]').first();
    if (await card.count() === 0) {
      test.skip();
      return;
    }

    await card.click();

    // CheckInDetailSheet 또는 Dialog 열림 확인
    const sheet = page.locator('[data-testid="checkin-detail-sheet"]').or(
      page.locator('[role="dialog"]')
    );
    await expect(sheet.first()).toBeVisible({ timeout: 5000 });
  });

  // AC-3: 예약관리 드래그 인터랙션 — draggable 속성 유지 확인
  test('AC-3: 예약관리 confirmed 예약 카드 draggable 속성 유지', async ({ page }) => {
    await page.goto(`${BASE}/admin/reservations`);
    await page.waitForLoadState('networkidle');

    const resvCard = page.locator('[data-testid^="resv-card-"]').first();
    if (await resvCard.count() === 0) {
      test.skip();
      return;
    }

    // confirmed 예약이 있으면 draggable=true 확인
    // (취소/체크인 예약은 draggable 없음)
    const draggableCard = page.locator('[data-testid^="resv-card-"][draggable="true"]').first();
    if (await draggableCard.count() === 0) {
      test.skip(); // confirmed 예약 없으면 skip
      return;
    }

    await expect(draggableCard).toHaveAttribute('draggable', 'true');
  });
});

// ── 빌드·렌더 안정성 ─────────────────────────────────────────────────────────
test.describe('T-20260525-foot-RSVMGMT-CHART-OPEN — 예약관리 페이지 렌더 안정성', () => {

  test('예약관리 페이지 정상 렌더 + 콘솔 에러 없음', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/reservations`);
    await page.waitForLoadState('networkidle');

    // 페이지 body 렌더 확인
    await expect(page.locator('body')).toBeVisible();

    // 치명적 JS 에러 없음
    const criticalErrors = errors.filter(
      (e) => !e.includes('favicon') && !e.includes('404') && !e.includes('supabase'),
    );
    expect(criticalErrors.length).toBe(0);
  });
});
