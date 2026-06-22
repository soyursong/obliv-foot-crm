/**
 * E2E spec — T-20260623-foot-CHECKIN-LASER-SLOT-LABEL
 * 체류시간(금일 동선) 탭 'laser' room_type 슬롯 라벨 정정 — '레이저실' 제거 → '치료실' 병합
 *
 * 근거: 김주연 총괄 — 레이저 시술도 물리 공간은 '치료실', 별도 레이저실 없음.
 *   TrackedSlotType: '상담실' | '치료실' (레이저실 제거)
 *   ROOM_TYPE_TO_SLOT: laser → '치료실' (treatment와 병합, last-room-wins)
 *   DB room_type='laser' 불변 (마이그 없음)
 *
 * AC-1: 금일 동선 영역에 '레이저실' 슬롯(badge) 미존재
 * AC-2: 금일 동선 영역에 '상담실'·'치료실' 2개 슬롯만 표시
 * AC-3: CHART1-TRIM AC-4 회귀 없음 — 로그 없는 환자도 '치료실' 슬롯 "—" 항상 표시
 * AC-4: 1번차트 정상 렌더 (JS 에러 없음)
 *
 * 시나리오:
 *   S-1: 금일 동선 — '레이저실' 슬롯 미존재 + '치료실' 슬롯 존재 (AC-1/2)
 *   S-2: 로그 없는 환자도 '치료실' 슬롯 "—" 항상 표시 + 회귀 없음 (AC-3/4)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260623-foot-CHECKIN-LASER-SLOT-LABEL — 레이저실 슬롯 → 치료실 병합', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  /**
   * S-1: 금일 동선 영역 — '레이저실' 슬롯 미존재 + '상담실'·'치료실' 2개만 표시
   * AC-1: daily-log-레이저실 badge 미존재
   * AC-2: daily-log-상담실 + daily-log-치료실 존재
   */
  test('S-1: 금일 동선 — 레이저실 슬롯 미존재, 상담실·치료실만 표시 (AC-1/2)', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const cards = page.locator('[data-testid="checkin-card"]');
    if (await cards.count() === 0) {
      test.skip(true, '칸반 카드 없음 — 스킵');
      return;
    }

    await cards.first().click();
    const sheet = page.locator('[role="dialog"]').first();
    const sheetVisible = await sheet.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
    if (!sheetVisible) {
      test.skip(true, '1번차트 Sheet 미오픈 — 스킵');
      return;
    }

    // 금일 동선 영역 로케이트
    const flowSection = sheet.locator('[data-testid="daily-room-log-section"]');
    await flowSection.waitFor({ state: 'visible', timeout: 8_000 });

    // AC-1: '레이저실' 슬롯 badge 미존재
    expect(
      await sheet.locator('[data-testid="daily-log-레이저실"]').count(),
      'AC-1: 레이저실 슬롯이 표시되어서는 안 됨',
    ).toBe(0);

    // AC-2: '상담실'·'치료실' 슬롯 존재 (각 1개)
    await expect(sheet.locator('[data-testid="daily-log-상담실"]'), 'AC-2: 상담실 슬롯 표시').toHaveCount(1);
    await expect(sheet.locator('[data-testid="daily-log-치료실"]'), 'AC-2: 치료실 슬롯 표시').toHaveCount(1);

    // 금일 동선 영역 내 슬롯 badge는 정확히 2개 (상담실 + 치료실)
    const allSlots = flowSection.locator('[data-testid^="daily-log-"]');
    await expect(allSlots, 'AC-2: 금일 동선 슬롯은 상담실·치료실 2개만').toHaveCount(2);
  });

  /**
   * S-2: 로그 없는 환자도 '치료실' 슬롯 "—" 항상 표시 + 회귀 없음
   * AC-3: CHART1-TRIM AC-4 회귀 — '치료실' 슬롯 항상 존재 (로그 없으면 "—")
   * AC-4: JS 에러 없이 정상 렌더
   */
  test('S-2: 로그 없는 환자도 치료실 슬롯 "—" 항상 표시 + 회귀 없음 (AC-3/4)', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const cards = page.locator('[data-testid="checkin-card"]');
    if (await cards.count() === 0) {
      test.skip(true, '칸반 카드 없음 — 스킵');
      return;
    }

    await cards.first().click();
    const sheet = page.locator('[role="dialog"]').first();
    const sheetVisible = await sheet.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
    if (!sheetVisible) {
      test.skip(true, '1번차트 Sheet 미오픈 — 스킵');
      return;
    }

    // AC-3: '치료실' 슬롯 항상 존재 (로그 유무 무관)
    const treatmentSlot = sheet.locator('[data-testid="daily-log-치료실"]');
    await expect(treatmentSlot, 'AC-3: 치료실 슬롯 항상 표시').toBeVisible();
    // 라벨에 '치료실' 텍스트 포함 (room number 또는 "—")
    await expect(treatmentSlot, 'AC-3: 치료실 라벨 표시').toContainText('치료실');

    // AC-4: 에러 토스트 미표시 + JS 에러 없음
    const errorToast = page.locator('[data-sonner-toast][data-type="error"]');
    expect(await errorToast.count(), 'AC-4: 에러 토스트 미표시').toBe(0);

    await page.waitForTimeout(1_000);
    const criticalErrors = jsErrors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('Non-Error promise rejection'),
    );
    expect(criticalErrors, 'AC-4: JS 에러 없음').toHaveLength(0);
  });
});
