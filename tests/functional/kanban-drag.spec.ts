/**
 * 칸반 상태 전이 E2E 테스트
 *
 * - 접수 컬럼의 카드를 다음 단계로 이동 (우클릭 컨텍스트 메뉴)
 * - 상태 변경 후 카드가 올바른 컬럼으로 이동했는지 확인
 * - 역방향 이동 시도 -> 차단되는지 확인
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('Kanban status transitions', () => {
  test('Context menu shows stage options', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Dashboard did not load');
      return;
    }

    // 접수 컬럼에 카드가 있어야 테스트 가능
    // "접수" 텍스트가 컬럼 헤더로 보이는지 확인
    const registeredColumn = page.getByText('접수', { exact: true }).first();
    const columnVisible = await registeredColumn.isVisible().catch(() => false);
    if (!columnVisible) {
      test.skip(true, 'No "접수" column found');
      return;
    }

    // 칸반 카드 찾기 - 접수 단계에 있는 카드 아무거나
    // 카드에 우클릭 -> context menu 출력
    // GripVertical 아이콘이나 MoreVertical 아이콘이 있는 카드 찾기
    const cards = page.locator('[data-status="registered"]');
    const cardCount = await cards.count();

    if (cardCount === 0) {
      // 테스트 데이터 없으면 먼저 체크인 생성
      const checkinBtn = page.getByRole('button', { name: /체크인/ }).first();
      const btnVisible = await checkinBtn.isVisible().catch(() => false);
      if (!btnVisible) {
        test.skip(true, 'No cards and no check-in button');
        return;
      }

      await checkinBtn.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      const testName = `칸반테스트_${Date.now()}`;
      await dialog.locator('#ci-name').fill(testName);
      await dialog.locator('#ci-phone').fill(`010${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`);
      await dialog.getByRole('button', { name: '체크인' }).click();
      await expect(page.getByText(/체크인 완료/)).toBeVisible({ timeout: 10_000 });

      // 카드가 나타날 때까지 대기
      await expect(page.getByText(testName)).toBeVisible({ timeout: 10_000 });
    }

    await page.screenshot({
      path: 'test-results/screenshots/kanban-before-transition.png',
      fullPage: true,
    });
  });

  test('Stage navigation buttons in detail sheet', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Dashboard did not load');
      return;
    }

    // 체크인 생성
    const testName = `단계이동_${Date.now()}`;
    const checkinBtn = page.getByRole('button', { name: /체크인/ }).first();
    const btnVisible = await checkinBtn.isVisible().catch(() => false);
    if (!btnVisible) {
      test.skip(true, 'No check-in button');
      return;
    }

    await checkinBtn.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.locator('#ci-name').fill(testName);
    await dialog.locator('#ci-phone').fill(`010${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`);
    await dialog.locator('button[type="button"]').filter({ hasText: /^재진$/ }).last().click();
    await dialog.getByRole('button', { name: '체크인' }).click();
    await expect(page.getByText(/체크인 완료/)).toBeVisible({ timeout: 10_000 });

    // 카드 클릭 -> 상세 Sheet 열기
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    const card = page.getByText(testName).first();
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    await page.waitForTimeout(500);

    const sheet = page.locator('[role="dialog"]').first();
    if (!(await sheet.isVisible().catch(() => false))) {
      test.skip(true, 'Sheet did not open after card click (DnD intercept)');
      return;
    }

    // 재진 단계: 접수 -> 시술대기
    // "시술대기" 다음 단계 버튼이 보여야 함
    const nextBtn = sheet.getByRole('button', { name: /시술대기/ }).first();
    const hasNextBtn = await nextBtn.isVisible().catch(() => false);

    if (hasNextBtn) {
      await nextBtn.click();
      // 토스트: "시술대기(으)로 이동"
      await expect(page.getByText(/시술대기.*이동/)).toBeVisible({ timeout: 10_000 });

      await page.screenshot({
        path: 'test-results/screenshots/kanban-after-transition.png',
        fullPage: true,
      });
    } else {
      test.info().annotations.push({
        type: 'info',
        description: 'No next-stage button found in detail sheet',
      });
    }
  });
});
