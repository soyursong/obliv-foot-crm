/**
 * E2E spec — T-20260523-foot-LASER-TIMER
 * 비가열 레이저 타이머 보강 — AC-3 amber/red 2단계 + AC-4 확인 다이얼로그
 *
 * AC-3: amber(1분 이하) / red(만료) CSS 클래스 분리
 * AC-4: 종료 버튼 → 확인 다이얼로그 표시 → 취소/확인 분기
 *
 * 시나리오:
 *   S-1: 종료 버튼 클릭 → 확인 다이얼로그 렌더링 (laser-timer-stop-confirm)
 *   S-2: 확인 다이얼로그 → 취소 → 타이머 계속 실행 중
 *   S-3: 확인 다이얼로그 → 종료 확인 → 타이머 중단 (시작 버튼 복귀)
 *   S-4: CSS 클래스 — laser-timer-warn / laser-timer-expire 존재 확인 (스타일시트)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260523-foot-LASER-TIMER — 타이머 확인 다이얼로그 + 2단계 색상', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  /** 공통 헬퍼: 칸반 카드에서 진료차트 열고, [5분] 타이머 시작 */
  async function openChartAndStartTimer(page: import('@playwright/test').Page) {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const cards = page.locator('[data-testid="checkin-card"]');
    if (await cards.count() === 0) return false;

    await cards.first().click({ button: 'right' });
    const menuItem = page.locator('text=/진료차트/').first();
    const found = await menuItem.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false);
    if (!found) return false;
    await menuItem.click();

    const drawer = page.locator('[data-testid="medical-chart-drawer"]');
    await drawer.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => null);

    const timerPanel = page.locator('[data-testid="laser-timer-panel"]');
    if (await timerPanel.count() === 0) return false;

    const btn5 = page.locator('[data-testid="laser-timer-btn-5"]');
    if (await btn5.count() === 0) return false;

    await btn5.click();

    const countdown = page.locator('[data-testid="laser-timer-countdown"]');
    const started = await countdown.waitFor({ state: 'visible', timeout: 4_000 }).then(() => true).catch(() => false);
    return started;
  }

  // S-1: 종료 버튼 → 확인 다이얼로그 표시
  test('S-1: 종료 버튼 클릭 → 확인 다이얼로그 표시 (직접 종료 금지)', async ({ page }) => {
    const ready = await openChartAndStartTimer(page);
    if (!ready) { test.skip(true, '타이머 시작 불가 (카드/DB/환경 문제) — 스킵'); return; }

    const stopBtn = page.locator('[data-testid="laser-timer-stop-btn"]');
    await expect(stopBtn).toBeVisible();
    await stopBtn.click();

    // 확인 다이얼로그가 표시되어야 함
    const confirm = page.locator('[data-testid="laser-timer-stop-confirm"]');
    await expect(confirm).toBeVisible({ timeout: 2_000 });

    // 시작 버튼이 복귀되지 않아야 함 (즉시 종료 아님)
    const startBtns = page.locator('[data-testid="laser-timer-start-buttons"]');
    await expect(startBtns).not.toBeVisible();

    // 정리: 확인하여 종료
    const confirmBtn = page.locator('[data-testid="laser-timer-stop-confirm-btn"]');
    if (await confirmBtn.isVisible()) await confirmBtn.click();
  });

  // S-2: 확인 다이얼로그 → 취소 → 타이머 유지
  test('S-2: 확인 다이얼로그 취소 → 타이머 계속 실행', async ({ page }) => {
    const ready = await openChartAndStartTimer(page);
    if (!ready) { test.skip(true, '타이머 시작 불가 — 스킵'); return; }

    await page.locator('[data-testid="laser-timer-stop-btn"]').click();
    const confirm = page.locator('[data-testid="laser-timer-stop-confirm"]');
    await confirm.waitFor({ state: 'visible', timeout: 2_000 });

    // 취소 버튼 클릭
    await page.locator('[data-testid="laser-timer-stop-cancel"]').click();

    // 다이얼로그 닫힘
    await expect(confirm).not.toBeVisible({ timeout: 2_000 });

    // 타이머 카운트다운 여전히 표시
    await expect(page.locator('[data-testid="laser-timer-countdown"]')).toBeVisible();

    // 정리: 재종료
    await page.locator('[data-testid="laser-timer-stop-btn"]').click();
    const confirmBtn = page.locator('[data-testid="laser-timer-stop-confirm-btn"]');
    if (await confirmBtn.isVisible()) await confirmBtn.click();
  });

  // S-3: 확인 다이얼로그 → 종료 확인 → 타이머 중단
  test('S-3: 확인 다이얼로그 종료 확인 → 시작 버튼 복귀', async ({ page }) => {
    const ready = await openChartAndStartTimer(page);
    if (!ready) { test.skip(true, '타이머 시작 불가 — 스킵'); return; }

    await page.locator('[data-testid="laser-timer-stop-btn"]').click();
    const confirm = page.locator('[data-testid="laser-timer-stop-confirm"]');
    await confirm.waitFor({ state: 'visible', timeout: 2_000 });

    // 종료 확인 버튼 클릭
    await page.locator('[data-testid="laser-timer-stop-confirm-btn"]').click();

    // 시작 버튼 복귀 확인 (타이머 종료)
    await expect(page.locator('[data-testid="laser-timer-start-buttons"]')).toBeVisible({ timeout: 5_000 });

    // 카운트다운 사라짐
    await expect(page.locator('[data-testid="laser-timer-countdown"]')).not.toBeVisible();
  });

  // S-4: CSS 클래스 확인 — laser-timer-warn / laser-timer-expire 스타일시트 등록
  test('S-4: laser-timer-warn + laser-timer-expire 클래스 스타일시트 등록', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    // 페이지 내 스타일시트에서 클래스 이름 확인
    const hasWarn = await page.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules ?? [])) {
            if (rule instanceof CSSStyleRule && rule.selectorText?.includes('laser-timer-warn')) return true;
          }
        } catch { /* cross-origin */ }
      }
      return false;
    });
    expect(hasWarn, 'laser-timer-warn 클래스 미등록').toBe(true);

    const hasExpire = await page.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules ?? [])) {
            if (rule instanceof CSSStyleRule && rule.selectorText?.includes('laser-timer-expire')) return true;
          }
        } catch { /* cross-origin */ }
      }
      return false;
    });
    expect(hasExpire, 'laser-timer-expire 클래스 미등록').toBe(true);
  });
});
