/**
 * E2E spec — T-20260613-foot-DUMMY-CHARTFIX (AC-3 브라우저 실클릭 차트검증, L-009 DoD)
 *
 * 배경: 6/13 결함더미 52건(이중생성, customer_id NULL)을 cleanup 후 표준 26건
 *       (customers+reservations 동시 INSERT, customer_id 직결, 고유이름) 재생성.
 * 목적: 프로그램 openChartFor DB-PASS ≠ 현장 미열림(6/12 괴리) 재발 방지 —
 *       실제 브라우저에서 더미 예약 카드 클릭 → 차트 시트가 열리는지 눈으로 검증.
 *
 * jongno-foot 어드민(test@medibuilder.com, clinic 74967aea) 로그인 →
 * 오늘(2026-06-13) 시간표의 더미 초진/재진 카드 클릭 → 차트 시트 OPEN 단언.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// apply 스크립트가 생성한 더미 이름 (10:00~12:30 앞 6슬롯에서 초진3·재진3 검증)
const NEW_NAMES = ['남궁현', '여민하', '하태경'];   // 초진(box1-resv-card)
const RET_NAMES = ['차예솔', '주아린', '전도윤'];   // 재진(box2-resv-card)

async function clickCardAndAssertChart(page, testid: string, name: string) {
  // 카드: data-testid + 이름 텍스트 포함 (오늘 시간표에 노출 전제)
  const card = page.locator(`[data-testid="${testid}"]`, { hasText: name }).first();
  await expect(card, `${name} 더미 카드가 시간표에 노출`).toBeVisible({ timeout: 15_000 });
  await card.click();

  // 차트 시트(CustomerChartSheet / CheckInDetailSheet = radix dialog/sheet) 오픈 대기
  const sheet = page.locator('[role="dialog"], [data-radix-dialog-content], [data-radix-sheet-content]').first();
  await expect(sheet, `${name} 클릭 후 차트 시트 OPEN`).toBeVisible({ timeout: 8_000 });
  // 시트 안에 환자 이름 노출 → 올바른 차트가 열렸는지 (빈 화면/WSOD 아님)
  await expect(sheet.getByText(name).first(), `차트 시트에 ${name} 렌더(blank/WSOD 아님)`).toBeVisible({ timeout: 5_000 });

  await page.screenshot({ path: `test-results/chartfix-${testid}-${name}.png` });
  // 다음 카드 위해 시트 닫기 (ESC)
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

test.describe('T-20260613 DUMMY-CHARTFIX — 더미 차트 브라우저 실오픈 (AC-3)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — 스킵');
  });

  test('초진 더미 3건 클릭 → 차트 시트 OPEN', async ({ page }) => {
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
    for (const name of NEW_NAMES) {
      await clickCardAndAssertChart(page, 'box1-resv-card', name);
    }
  });

  test('재진 더미 3건 클릭 → 차트 시트 OPEN', async ({ page }) => {
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
    for (const name of RET_NAMES) {
      await clickCardAndAssertChart(page, 'box2-resv-card', name);
    }
  });
});
