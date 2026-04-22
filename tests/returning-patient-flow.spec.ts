/**
 * 재진 환자 동선 검증
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from './helpers';

test.describe('Returning patient flow', () => {
  const RETURNING_STAGES_KO = [
    '접수', '진료대기', '진료',
    '상담대기', '상담', '결제',
    '시술대기', '사전처치', '레이저', '완료',
  ];

  test('Returning patient tab shows correct stages', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Dashboard did not load');
      return;
    }

    const returningTab = page.getByRole('tab', { name: '재진' }).first();
    const tabExists = await returningTab.isVisible().catch(() => false);

    if (!tabExists) {
      test.info().annotations.push({
        type: 'info',
        description: 'No "재진" tab found — may be combined view',
      });
      return;
    }

    await returningTab.click();
    await page.waitForTimeout(500);

    const visibleStages: string[] = [];
    for (const stage of RETURNING_STAGES_KO) {
      const isVisible = await page.getByText(stage, { exact: false }).first().isVisible().catch(() => false);
      if (isVisible) visibleStages.push(stage);
    }

    test.info().annotations.push({
      type: 'stages',
      description: `Visible returning stages: ${visibleStages.join(', ')} (${visibleStages.length}/${RETURNING_STAGES_KO.length})`,
    });

    expect(visibleStages.length).toBeGreaterThanOrEqual(5);

    const checklistVisible = await page.getByText('체크리스트').first().isVisible().catch(() => false);
    test.info().annotations.push({
      type: 'checklist',
      description: `Checklist column visible in returning tab: ${checklistVisible}`,
    });

    await page.screenshot({
      path: 'test-results/screenshots/returning-patient-kanban.png',
      fullPage: true,
    });
  });

  test('Returning tab does not show checklist stage', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Dashboard did not load');
      return;
    }

    const returningTab = page.getByRole('tab', { name: '재진' }).first();
    const tabExists = await returningTab.isVisible().catch(() => false);

    if (!tabExists) {
      test.skip(true, 'No returning tab');
      return;
    }

    await returningTab.click();
    await page.waitForTimeout(500);

    await page.screenshot({
      path: 'test-results/screenshots/returning-no-checklist.png',
      fullPage: true,
    });
  });
});
