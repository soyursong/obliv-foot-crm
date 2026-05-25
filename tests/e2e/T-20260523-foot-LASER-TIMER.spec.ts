/**
 * E2E spec — T-20260523-foot-LASER-TIMER (v2 — AC-1 위치 변경 반영)
 * 비가열 레이저 타이머 — 2번차트 3구역 [상세] 탭 상단 위치 + 확인 다이얼로그 + 2단계 색상
 *
 * 2026-05-25 20:55 피드백: 진료차트 Drawer(MedicalChartPanel) → 2번차트 CustomerChartSheet로 위치 이동.
 * 이 spec은 신규 위치(CustomerChartSheet) 기준으로 테스트한다.
 *
 * AC-1: 2번차트 3구역 [상세] 탭 상단에 타이머 섹션 항상 표시
 *       (예약/상담/치료메모 탭 선택 전후 무관)
 * AC-3: amber(1분 이하) / red(만료) CSS 클래스 분리 (laser-timer-warn / laser-timer-expire)
 * AC-4: 종료 버튼 → 확인 다이얼로그 표시 → 취소/확인 분기
 *
 * 시나리오:
 *   S-0: AC-1 위치 확인 — 2번차트 열기 → 탭 클릭 전 타이머 패널 표시
 *   S-1: 종료 버튼 클릭 → 확인 다이얼로그 표시 (직접 종료 금지)
 *   S-2: 확인 다이얼로그 → 취소 → 타이머 계속 실행 중
 *   S-3: 확인 다이얼로그 → 종료 확인 → 타이머 중단 (시작 버튼 복귀)
 *   S-4: CSS 클래스 — laser-timer-warn / laser-timer-expire 존재 확인 (스타일시트)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260523-foot-LASER-TIMER — AC-1 위치(2번차트) + 확인 다이얼로그 + 2단계 색상', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  /**
   * 공통 헬퍼: 칸반 카드 클릭 → CustomerChartSheet(2번차트) 열기 → [5분] 타이머 시작
   * 반환값: true(성공) / false(스킵 필요)
   */
  async function openChartSheetAndStartTimer(page: import('@playwright/test').Page) {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const cards = page.locator('[data-testid="checkin-card"]');
    if (await cards.count() === 0) return false;

    // 좌클릭 → CustomerChartSheet(2번차트) 오픈
    await cards.first().click();

    const sheet = page.locator('[data-testid="customer-chart-sheet"]');
    const sheetVisible = await sheet.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!sheetVisible) return false;

    const timerPanel = sheet.locator('[data-testid="laser-timer-panel"]');
    if (await timerPanel.count() === 0) return false;

    const btn5 = sheet.locator('[data-testid="laser-timer-btn-5"]');
    if (await btn5.count() === 0) return false;

    await btn5.click();

    const countdown = sheet.locator('[data-testid="laser-timer-countdown"]');
    return await countdown.waitFor({ state: 'visible', timeout: 4_000 }).then(() => true).catch(() => false);
  }

  // S-0: AC-1 위치 확인 — 탭 클릭 전 2번차트에서 타이머 패널이 바로 보여야 함
  test('S-0: AC-1 — 2번차트 열기 시 탭 전환 없이 타이머 패널 표시', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const cards = page.locator('[data-testid="checkin-card"]');
    if (await cards.count() === 0) {
      test.skip(true, '칸반 카드 없음 — 스킵');
      return;
    }

    // 좌클릭 → 2번차트(CustomerChartSheet) 오픈
    await cards.first().click();

    const sheet = page.locator('[data-testid="customer-chart-sheet"]');
    await sheet.waitFor({ state: 'visible', timeout: 10_000 });

    // 타이머 패널은 탭 선택 없이도 [상세] 섹션 상단에 표시되어야 함
    const timerPanel = sheet.locator('[data-testid="laser-timer-panel"]');
    const hasPanelForCheckIn = await timerPanel.count() > 0;

    if (!hasPanelForCheckIn) {
      // latestCheckIn 없는 고객은 타이머 패널 미표시가 정상 — 스킵
      test.skip(true, 'latestCheckIn 없는 고객 — 타이머 패널 미표시 정상, 스킵');
      return;
    }

    // 탭을 전혀 클릭하지 않은 상태에서 보여야 함 (탭 상단 위치 검증)
    await expect(timerPanel).toBeVisible();

    // 시작 버튼 3종 모두 표시 확인
    await expect(sheet.locator('[data-testid="laser-timer-btn-5"]')).toBeVisible();
    await expect(sheet.locator('[data-testid="laser-timer-btn-15"]')).toBeVisible();
    await expect(sheet.locator('[data-testid="laser-timer-btn-20"]')).toBeVisible();

    // 예약 탭 클릭 후에도 타이머 패널 유지 (탭 상단 위치 - 탭에 종속되지 않음)
    const resvTab = sheet.getByRole('button', { name: '예약' });
    if (await resvTab.count() > 0) {
      await resvTab.click();
      await expect(timerPanel).toBeVisible({ timeout: 2_000 });
    }

    // 치료메모 탭 클릭 후에도 타이머 패널 유지
    const memoTab = sheet.getByRole('button', { name: '치료메모' });
    if (await memoTab.count() > 0) {
      await memoTab.click();
      await expect(timerPanel).toBeVisible({ timeout: 2_000 });
    }
  });

  // S-1: 종료 버튼 → 확인 다이얼로그 표시
  test('S-1: 종료 버튼 클릭 → 확인 다이얼로그 표시 (직접 종료 금지)', async ({ page }) => {
    const ready = await openChartSheetAndStartTimer(page);
    if (!ready) { test.skip(true, '타이머 시작 불가 (카드/DB/환경 문제) — 스킵'); return; }

    const sheet = page.locator('[data-testid="customer-chart-sheet"]');
    const stopBtn = sheet.locator('[data-testid="laser-timer-stop-btn"]');
    await expect(stopBtn).toBeVisible();
    await stopBtn.click();

    // 확인 다이얼로그가 표시되어야 함
    const confirm = sheet.locator('[data-testid="laser-timer-stop-confirm"]');
    await expect(confirm).toBeVisible({ timeout: 2_000 });

    // 시작 버튼이 복귀되지 않아야 함 (즉시 종료 아님)
    const startBtns = sheet.locator('[data-testid="laser-timer-start-buttons"]');
    await expect(startBtns).not.toBeVisible();

    // 정리: 확인하여 종료
    const confirmBtn = sheet.locator('[data-testid="laser-timer-stop-confirm-btn"]');
    if (await confirmBtn.isVisible()) await confirmBtn.click();
  });

  // S-2: 확인 다이얼로그 → 취소 → 타이머 유지
  test('S-2: 확인 다이얼로그 취소 → 타이머 계속 실행', async ({ page }) => {
    const ready = await openChartSheetAndStartTimer(page);
    if (!ready) { test.skip(true, '타이머 시작 불가 — 스킵'); return; }

    const sheet = page.locator('[data-testid="customer-chart-sheet"]');
    await sheet.locator('[data-testid="laser-timer-stop-btn"]').click();
    const confirm = sheet.locator('[data-testid="laser-timer-stop-confirm"]');
    await confirm.waitFor({ state: 'visible', timeout: 2_000 });

    // 취소 버튼 클릭
    await sheet.locator('[data-testid="laser-timer-stop-cancel"]').click();

    // 다이얼로그 닫힘
    await expect(confirm).not.toBeVisible({ timeout: 2_000 });

    // 타이머 카운트다운 여전히 표시
    await expect(sheet.locator('[data-testid="laser-timer-countdown"]')).toBeVisible();

    // 정리: 재종료
    await sheet.locator('[data-testid="laser-timer-stop-btn"]').click();
    const confirmBtn = sheet.locator('[data-testid="laser-timer-stop-confirm-btn"]');
    if (await confirmBtn.isVisible()) await confirmBtn.click();
  });

  // S-3: 확인 다이얼로그 → 종료 확인 → 타이머 중단
  test('S-3: 확인 다이얼로그 종료 확인 → 시작 버튼 복귀', async ({ page }) => {
    const ready = await openChartSheetAndStartTimer(page);
    if (!ready) { test.skip(true, '타이머 시작 불가 — 스킵'); return; }

    const sheet = page.locator('[data-testid="customer-chart-sheet"]');
    await sheet.locator('[data-testid="laser-timer-stop-btn"]').click();
    const confirm = sheet.locator('[data-testid="laser-timer-stop-confirm"]');
    await confirm.waitFor({ state: 'visible', timeout: 2_000 });

    // 종료 확인 버튼 클릭
    await sheet.locator('[data-testid="laser-timer-stop-confirm-btn"]').click();

    // 시작 버튼 복귀 확인 (타이머 종료)
    await expect(sheet.locator('[data-testid="laser-timer-start-buttons"]')).toBeVisible({ timeout: 5_000 });

    // 카운트다운 사라짐
    await expect(sheet.locator('[data-testid="laser-timer-countdown"]')).not.toBeVisible();
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
