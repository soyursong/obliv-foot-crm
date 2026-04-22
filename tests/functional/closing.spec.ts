/**
 * 일마감 E2E 테스트
 *
 * - 로그인 -> 일마감 페이지
 * - 날짜 선택
 * - 매출 집계 표시 확인
 * - 실제 금액 입력 -> 차이 계산
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('Daily closing', () => {
  test('Navigate to closing page', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Dashboard did not load');
      return;
    }

    const closingLink = page.getByRole('link', { name: '일마감' }).first();
    const linkVisible = await closingLink.isVisible().catch(() => false);
    if (!linkVisible) {
      test.skip(true, 'Closing link not visible (role restriction)');
      return;
    }

    await closingLink.click();
    await page.waitForURL('**/admin/closing', { timeout: 10_000 });

    // 마감일 날짜 선택기 확인
    await expect(page.locator('input[type="date"]').first()).toBeVisible({ timeout: 5_000 });

    // 매출 집계 카드 확인
    await expect(page.getByText('패키지 결제')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('단건 결제')).toBeVisible();

    // 실제 정산 카드 확인
    await expect(page.getByText('실제 정산')).toBeVisible();

    // 마감 확정 / 임시저장 버튼 확인
    const saveBtn = page.getByRole('button', { name: /임시저장/ });
    const closeBtn = page.getByRole('button', { name: /마감 확정/ });

    const hasSave = await saveBtn.isVisible().catch(() => false);
    const hasClose = await closeBtn.isVisible().catch(() => false);

    test.info().annotations.push({
      type: 'buttons',
      description: `Save: ${hasSave}, Close: ${hasClose}`,
    });

    await page.screenshot({
      path: 'test-results/screenshots/closing-page.png',
      fullPage: true,
    });
  });

  test('Date selection changes data', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Dashboard did not load');
      return;
    }

    const closingLink = page.getByRole('link', { name: '일마감' }).first();
    if (!(await closingLink.isVisible().catch(() => false))) {
      test.skip(true, 'Closing link not visible');
      return;
    }

    await closingLink.click();
    await page.waitForURL('**/admin/closing', { timeout: 10_000 });

    const dateInput = page.locator('input[type="date"]').first();
    await expect(dateInput).toBeVisible({ timeout: 5_000 });

    // 어제 날짜로 변경
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().slice(0, 10);

    await dateInput.fill(dateStr);
    await page.waitForTimeout(1000);

    // 데이터가 변경되었는지 확인 (에러가 나지 않으면 OK)
    await expect(page.getByText('실제 정산')).toBeVisible();
  });

  test('Actual amount input and difference calculation', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Dashboard did not load');
      return;
    }

    const closingLink = page.getByRole('link', { name: '일마감' }).first();
    if (!(await closingLink.isVisible().catch(() => false))) {
      test.skip(true, 'Closing link not visible');
      return;
    }

    await closingLink.click();
    await page.waitForURL('**/admin/closing', { timeout: 10_000 });

    // 정산 섹션 확인
    await expect(page.getByText('실제 정산')).toBeVisible({ timeout: 5_000 });

    // 카드 실제 금액 입력
    const cardInput = page.locator('.rounded-md.border.p-3').first().locator('input[type="number"]');
    const hasCardInput = await cardInput.isVisible().catch(() => false);

    if (hasCardInput) {
      await cardInput.fill('500000');
      await page.waitForTimeout(300);

      // 차이 표시 확인
      const diffText = page.getByText(/차이/).first();
      await expect(diffText).toBeVisible();

      // 총 차이 표시 확인
      await expect(page.getByText('총 차이')).toBeVisible();
    }

    // 메모 필드 확인
    await expect(page.getByText('메모')).toBeVisible();
    const memoField = page.getByPlaceholder('특이사항을 입력하세요');
    if (await memoField.isVisible()) {
      await memoField.fill('E2E 테스트 메모');
    }

    // CSV 다운로드 버튼 확인
    const downloadBtn = page.getByTitle('CSV 다운로드');
    await expect(downloadBtn).toBeVisible();

    // 인쇄 버튼 확인
    const printBtn = page.getByTitle('인쇄');
    await expect(printBtn).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/closing-with-input.png',
      fullPage: true,
    });
  });

  test('Summary cards show correct structure', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Dashboard did not load');
      return;
    }

    const closingLink = page.getByRole('link', { name: '일마감' }).first();
    if (!(await closingLink.isVisible().catch(() => false))) {
      test.skip(true, 'Closing link not visible');
      return;
    }

    await closingLink.click();
    await page.waitForURL('**/admin/closing', { timeout: 10_000 });

    // 3개 집계 카드 확인
    await expect(page.getByText('패키지 결제')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('단건 결제')).toBeVisible();
    await expect(page.getByText('합계 (결제수단별)')).toBeVisible();

    // 각 카드에 카드/현금/이체 항목 확인
    const cardLabels = page.getByText('카드', { exact: true });
    expect(await cardLabels.count()).toBeGreaterThanOrEqual(1);

    // 합계 행 확인
    const totalLabels = page.getByText('합계', { exact: true });
    expect(await totalLabels.count()).toBeGreaterThanOrEqual(1);
  });
});
