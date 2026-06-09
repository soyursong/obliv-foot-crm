/**
 * T-20260610-foot-DUMMY-RESV-CHARTVERIFY — [P0] 브라우저 차트 열림 검증 (WSOD 탐지)
 *
 * 더미 24건(6/10, jongno-foot, memo='[TEST-DUMMY 20260610]')이 INSERT된 상태에서,
 * 대시보드(오늘=2026-06-10) 타임라인에서 실제 더미 카드를 클릭하여
 *   chart1 = CheckInDetailSheet / chart2 = CustomerChartSheet 정상 오픈을 확인한다.
 * 초진(box1) 3건 + 재진(box2) 3건. WSOD/blank/에러 시 RED → responder P0 에스컬레이션.
 *
 * 시드/삭제 안 함(read-only 클릭). apply.mjs 가 미리 데이터 생성, cleanup.mjs 가 사후 삭제.
 * 머지차단 게이트 아님(검증 전용 *.verify.spec.ts). 수동 실행:
 *   npx playwright test tests/e2e/T-20260610-foot-DUMMY-RESV-CHARTVERIFY.verify.spec.ts --project=desktop-chrome
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const NEW3 = ['김도현', '이준영', '박서윤'];
const RET3 = ['신아람', '권민수', '황지헌'];

async function waitForChartOpen(page: import('@playwright/test').Page, timeout = 9000): Promise<boolean> {
  return Promise.race([
    page.locator('[data-testid="chart-info-panel"]').waitFor({ state: 'visible', timeout }).then(() => true),
    page.getByText('SMART DOCTOR — 고객정보').waitFor({ state: 'visible', timeout }).then(() => true),
    page.getByText('불러오는 중').first().waitFor({ state: 'visible', timeout }).then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), timeout + 100)),
  ]);
}

async function closeAnyOpenSheet(page: import('@playwright/test').Page) {
  // ESC 두 번 — 2번/1번 차트 순차 닫기
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

test.describe('CHARTVERIFY 6/10 · 더미 카드 click→chart open (WSOD 탐지)', () => {
  test('초진 3 + 재진 3 차트 열림', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    expect(ok, '대시보드 진입 실패 — 검증 전제 미충족').toBe(true);
    await expect(page.getByTestId('dashboard-root')).toBeVisible({ timeout: 15000 });

    const results: { name: string; box: string; chart1: string; chart2: string }[] = [];

    // box1 = 초진 타임라인 카드
    for (const name of NEW3) {
      const card = page.locator('[data-testid="box1-resv-card"]', { hasText: name }).first();
      await card.waitFor({ state: 'visible', timeout: 15000 });
      await card.click();
      const opened = await waitForChartOpen(page);
      results.push({ name, box: 'box1(초진)', chart1: opened ? 'OPEN' : 'FAIL/WSOD', chart2: opened ? 'OPEN' : 'FAIL/WSOD' });
      await page.screenshot({ path: `test-results/chartverify-0610-${name}.png` });
      expect(opened, `초진 ${name} 카드 클릭 → 차트 오픈 실패(WSOD 의심)`).toBe(true);
      await closeAnyOpenSheet(page);
    }

    // box2 = 재진 타임라인 카드
    for (const name of RET3) {
      const card = page.locator('[data-testid="box2-resv-card"]', { hasText: name }).first();
      await card.waitFor({ state: 'visible', timeout: 15000 });
      await card.click();
      const opened = await waitForChartOpen(page);
      results.push({ name, box: 'box2(재진)', chart1: opened ? 'OPEN' : 'FAIL/WSOD', chart2: opened ? 'OPEN' : 'FAIL/WSOD' });
      await page.screenshot({ path: `test-results/chartverify-0610-${name}.png` });
      expect(opened, `재진 ${name} 카드 클릭 → 차트 오픈 실패(WSOD 의심)`).toBe(true);
      await closeAnyOpenSheet(page);
    }

    console.log('\n=== [P0] 브라우저 chart open 결과 ===');
    for (const r of results) console.log(`${r.box} | ${r.name} | chart1=${r.chart1} | chart2=${r.chart2}`);
    expect(results.every((r) => r.chart1 === 'OPEN' && r.chart2 === 'OPEN')).toBe(true);
  });
});
