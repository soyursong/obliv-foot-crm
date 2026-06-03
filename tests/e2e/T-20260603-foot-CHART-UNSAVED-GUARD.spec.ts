/**
 * T-20260603-foot-CHART-UNSAVED-GUARD — 차팅 중 미저장 데이터 손실 방어
 *
 * 배경: 2번차트(CustomerChartSheet) / 체크인 상세(CheckInDetailSheet) 차팅 중,
 *   메신저(별도 창) 확인 후 복귀 클릭이 백드롭에 닿으면 Sheet가 즉시 닫히며 작성 내용 소실.
 *
 * AC-1 [CustomerChartSheet]: dirty(사용자 입력 발생) 상태에서 백드롭/ESC 닫기 시
 *   즉시 닫지 않고 확인 다이얼로그(chart-close-confirm) 노출. "취소(계속 작성)" 시 내용 보존.
 *   미입력 상태면 confirm 없이 즉시 닫힘(마찰 최소).
 * AC-2 [CheckInDetailSheet]: 메모(예약/상담/치료/고객/기타) dirty 시 닫힘 이벤트(ESC/백드롭/X)에
 *   확인 다이얼로그(checkin-close-confirm) — "저장하지 않고 닫기" / "취소(계속 작성)".
 * AC-3 [P2 선택, localStorage draft]: 본 티켓 1차 범위에서 제외(별도 진행). skip 처리.
 *
 * 시나리오 매핑 (티켓 본문):
 *   S1 백드롭 가드(AC-1) / S2 ESC 가드(AC-1) / S3 3메모 보호(AC-2) / S4 임시저장 복원(AC-3, skip)
 *
 * 주의: 실서버 시드 데이터 의존 → 데이터/요소 없으면 graceful skip (기존 foot e2e 관례).
 */

import { test, expect, Page } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

/** Customers 목록에서 2번차트(CustomerChartSheet) 열기. 실패 시 null 반환. */
async function openSecondChart(page: Page) {
  await page.goto(`${BASE}/admin/customers`);
  await page.waitForLoadState('networkidle');
  const chartBtn = page.getByRole('button', { name: /차트보기|고객차트/ }).first();
  if ((await chartBtn.count()) === 0) return null;
  await chartBtn.click();
  const panel = page.locator('[data-testid="customer-chart-sheet"]');
  if ((await panel.count()) === 0) return null;
  await expect(panel).toBeVisible({ timeout: 6000 });
  return panel;
}

/** 2번차트 패널 내부의 편집 가능한 첫 input/textarea를 dirty 처리. 없으면 false. */
async function dirtyTheChart(page: Page) {
  // Suspense lazy 로드 완료 대기 — 입력 요소가 붙을 때까지
  const field = page
    .locator('[data-testid="customer-chart-sheet"]')
    .locator('textarea, input[type="text"], input:not([type])')
    .first();
  try {
    await field.waitFor({ state: 'visible', timeout: 6000 });
  } catch {
    return false;
  }
  await field.fill('테스트 상담 내용');
  return true;
}

test.describe('T-20260603-foot-CHART-UNSAVED-GUARD AC-1 — CustomerChartSheet 닫기 가드', () => {
  // ── S1: 백드롭 클릭 미저장 가드 ──────────────────────────────────────────
  test('S1: dirty 상태에서 백드롭 클릭 → 확인창 노출, "취소" 시 패널·내용 보존', async ({ page }) => {
    const panel = await openSecondChart(page);
    if (!panel) { test.skip(); return; }
    if (!(await dirtyTheChart(page))) { test.skip(); return; }

    // 백드롭 클릭 → 즉시 닫히지 않고 확인 다이얼로그 노출
    await page.locator('[data-testid="chart-backdrop"]').click({ force: true });
    const confirm = page.locator('[data-testid="chart-close-confirm"]');
    await expect(confirm).toBeVisible({ timeout: 3000 });

    // "취소(계속 작성)" → 패널 유지
    await page.locator('[data-testid="chart-close-cancel"]').click();
    await expect(confirm).toBeHidden();
    await expect(panel).toBeVisible();
  });

  // ── S2: ESC 키 미저장 가드 ───────────────────────────────────────────────
  test('S2: dirty 상태에서 ESC → 확인창 노출, "취소" 시 패널 유지', async ({ page }) => {
    const panel = await openSecondChart(page);
    if (!panel) { test.skip(); return; }
    if (!(await dirtyTheChart(page))) { test.skip(); return; }

    await page.keyboard.press('Escape');
    const confirm = page.locator('[data-testid="chart-close-confirm"]');
    await expect(confirm).toBeVisible({ timeout: 3000 });

    await page.locator('[data-testid="chart-close-cancel"]').click();
    await expect(panel).toBeVisible();
  });

  // ── 회귀: 미입력(non-dirty) 상태 백드롭 클릭 → confirm 없이 즉시 닫힘 ──────
  test('REG: 미입력 상태 백드롭 클릭 → 확인창 없이 즉시 닫힘(마찰 최소)', async ({ page }) => {
    const panel = await openSecondChart(page);
    if (!panel) { test.skip(); return; }
    // 입력 없이 바로 백드롭 클릭
    await page.locator('[data-testid="chart-backdrop"]').click({ force: true });
    await expect(page.locator('[data-testid="chart-close-confirm"]')).toBeHidden();
    await expect(panel).toBeHidden({ timeout: 3000 });
  });
});

test.describe('T-20260603-foot-CHART-UNSAVED-GUARD AC-2 — CheckInDetailSheet 메모 보호', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/admin`);
    await page.waitForLoadState('networkidle');
  });

  /** 대시보드 타임라인 카드 → 체크인 상세(CheckInDetailSheet) 열기. 실패 시 null. */
  async function openCheckInDetail(page: Page) {
    const card = page.locator('[data-testid="timeline-checkin-card"]').first();
    if ((await card.count()) === 0) return null;
    await card.click();
    const memo = page.getByPlaceholder('고객 성향, 특이사항, 주차 정보 등').first();
    try {
      await memo.waitFor({ state: 'visible', timeout: 6000 });
    } catch {
      return null;
    }
    return memo;
  }

  // ── S3: 메모 dirty 시 닫힘 이벤트 → 확인창("저장하지 않고 닫기"/"취소") ────
  test('S3: 메모 입력 후 ESC → 확인창, "취소" 시 시트·입력 내용 보존', async ({ page }) => {
    const memo = await openCheckInDetail(page);
    if (!memo) { test.skip(); return; }

    await memo.fill('손실되면 안 되는 메모');

    // ESC → 닫힘 이벤트 → 확인 다이얼로그
    await page.keyboard.press('Escape');
    const confirm = page.locator('[data-testid="checkin-close-confirm"]');
    await expect(confirm).toBeVisible({ timeout: 3000 });

    // "취소(계속 작성)" → 시트 유지 + 입력 내용 보존
    await page.locator('[data-testid="checkin-close-cancel"]').click();
    await expect(confirm).toBeHidden();
    await expect(memo).toBeVisible();
    await expect(memo).toHaveValue('손실되면 안 되는 메모');
  });

  // ── S3b: "저장하지 않고 닫기" → 실제 닫힘 ─────────────────────────────────
  test('S3b: 확인창에서 "저장하지 않고 닫기" → 시트 닫힘', async ({ page }) => {
    const memo = await openCheckInDetail(page);
    if (!memo) { test.skip(); return; }

    await memo.fill('임시 메모');
    await page.keyboard.press('Escape');
    const confirm = page.locator('[data-testid="checkin-close-confirm"]');
    await expect(confirm).toBeVisible({ timeout: 3000 });

    await page.locator('[data-testid="checkin-close-confirm-btn"]').click();
    await expect(memo).toBeHidden({ timeout: 3000 });
  });

  // ── REG: 미수정 상태 ESC → confirm 없이 즉시 닫힘(마찰 최소) ───────────────
  test('REG: 미수정 상태 ESC → 확인창 없이 즉시 닫힘', async ({ page }) => {
    const memo = await openCheckInDetail(page);
    if (!memo) { test.skip(); return; }
    // 입력 없이 ESC
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="checkin-close-confirm"]')).toBeHidden();
    await expect(memo).toBeHidden({ timeout: 3000 });
  });
});

test.describe('T-20260603-foot-CHART-UNSAVED-GUARD AC-3 — localStorage 임시저장(P2 선택)', () => {
  // AC-3는 본 티켓 1차 범위(AC-1/AC-2 우선) 밖. 별도 진행 예정 → 구현 시 활성화.
  test.skip('S4: 작성 중 새로고침 후 재오픈 시 복원 toast (AC-3 미구현 — 별도 진행)', async () => {
    // intentionally skipped — AC-3 deferred
  });
});
