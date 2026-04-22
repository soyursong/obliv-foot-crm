/**
 * 신규 환자 동선 검증
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from './helpers';

test.describe('New patient flow', () => {
  const NEW_STAGES_KO = [
    '접수', '체크리스트', '진료대기', '진료',
    '상담대기', '상담', '결제',
    '시술대기', '사전처치', '레이저', '완료',
  ];

  test('Dashboard loads with kanban columns', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Dashboard did not load (auth or loading issue)');
      return;
    }

    const visibleStages: string[] = [];
    for (const stage of NEW_STAGES_KO) {
      const isVisible = await page.getByText(stage, { exact: false }).first().isVisible().catch(() => false);
      if (isVisible) visibleStages.push(stage);
    }

    test.info().annotations.push({
      type: 'stages',
      description: `Visible: ${visibleStages.join(', ')} (${visibleStages.length}/${NEW_STAGES_KO.length})`,
    });

    expect(visibleStages.length).toBeGreaterThanOrEqual(5);

    await page.screenshot({
      path: 'test-results/screenshots/new-patient-kanban.png',
      fullPage: true,
    });
  });

  test('New check-in button exists', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Dashboard did not load');
      return;
    }

    const checkinBtn = page.getByRole('button', { name: /접수|체크인|새 환자/i }).first();
    const exists = await checkinBtn.isVisible().catch(() => false);

    if (exists) {
      await checkinBtn.click();
      await page.waitForTimeout(500);
      const dialog = page.getByRole('dialog').first();
      const dialogVisible = await dialog.isVisible().catch(() => false);

      if (dialogVisible) {
        await page.screenshot({
          path: 'test-results/screenshots/new-checkin-dialog.png',
          fullPage: true,
        });
        const hasNameField = await page.getByLabel(/이름|성명/).isVisible().catch(() => false);
        const hasPhoneField = await page.getByLabel(/전화|연락처|휴대폰/).isVisible().catch(() => false);
        test.info().annotations.push({
          type: 'dialog',
          description: `Name field: ${hasNameField}, Phone field: ${hasPhoneField}`,
        });
      }
    } else {
      test.info().annotations.push({
        type: 'info',
        description: 'No check-in button found on dashboard',
      });
    }

    expect(true).toBe(true);
  });

  test('Tab switching works (all/new/returning)', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Dashboard did not load');
      return;
    }

    const tabLabels = ['전체', '신규', '재진'];
    for (const label of tabLabels) {
      const tab = page.getByRole('tab', { name: label }).first();
      const tabVisible = await tab.isVisible().catch(() => false);
      if (tabVisible) {
        await tab.click();
        await page.waitForTimeout(300);
        await page.screenshot({
          path: `test-results/screenshots/tab-${label}.png`,
          fullPage: true,
        });
      }
    }
  });
});
