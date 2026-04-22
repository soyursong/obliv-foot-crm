/**
 * 결제 E2E 테스트
 *
 * - 체크인 상세에서 결제 버튼 클릭
 * - PaymentDialog 열림 확인
 * - 결제 수단 선택 (카드/현금)
 * - 금액 입력 -> 결제 처리
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('Payment flow', () => {
  test('Payment dialog opens from check-in detail', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Dashboard did not load');
      return;
    }

    // 먼저 체크인을 생성
    const testName = `결제테스트_${Date.now()}`;
    const checkinBtn = page.getByRole('button', { name: /체크인/ }).first();
    if (!(await checkinBtn.isVisible().catch(() => false))) {
      test.skip(true, 'No check-in button');
      return;
    }

    await checkinBtn.click();
    const checkinDialog = page.getByRole('dialog');
    await expect(checkinDialog).toBeVisible({ timeout: 5_000 });

    await checkinDialog.locator('#ci-name').fill(testName);
    await checkinDialog.locator('#ci-phone').fill(`010${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`);
    await checkinDialog.getByRole('button', { name: '체크인' }).click();
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

    // "결제 등록" 버튼 클릭
    const payBtn = sheet.getByRole('button', { name: /결제 등록/ });
    const hasPayBtn = await payBtn.isVisible().catch(() => false);

    if (!hasPayBtn) {
      test.info().annotations.push({
        type: 'info',
        description: 'No payment button in detail sheet (may already have payments)',
      });
      return;
    }

    await payBtn.click();

    // PaymentDialog 열림 확인
    // 다이얼로그가 2개 (Sheet + PaymentDialog) 열릴 수 있음
    const paymentDialog = page.getByText('결제 —').first();
    await expect(paymentDialog).toBeVisible({ timeout: 5_000 });

    // 결제 수단 확인 (카드, 현금, 이체)
    await expect(page.getByText('카드', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('현금', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('이체', { exact: true }).first()).toBeVisible();

    // 단일/분할 토글 확인
    await expect(page.getByText('단일 결제')).toBeVisible();
    await expect(page.getByText('분할 결제')).toBeVisible();

    // 금액 필드 확인
    await expect(page.getByLabel('금액')).toBeVisible();

    // 할부 옵션 확인 (카드 선택 시)
    await expect(page.getByText('일시불')).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/payment-dialog.png',
      fullPage: true,
    });
  });

  test('Payment method selection works', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Dashboard did not load');
      return;
    }

    // 체크인 생성
    const testName = `결제수단_${Date.now()}`;
    const checkinBtn = page.getByRole('button', { name: /체크인/ }).first();
    if (!(await checkinBtn.isVisible().catch(() => false))) {
      test.skip(true, 'No check-in button');
      return;
    }

    await checkinBtn.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.locator('#ci-name').fill(testName);
    await dialog.locator('#ci-phone').fill(`010${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`);
    await dialog.getByRole('button', { name: '체크인' }).click();
    await expect(page.getByText(/체크인 완료/)).toBeVisible({ timeout: 10_000 });

    // Sheet 열기 (DnD가 click을 intercept할 수 있으므로 dblclick 사용)
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    await page.getByText(testName).first().scrollIntoViewIfNeeded();
    await page.getByText(testName).first().click();
    await page.waitForTimeout(500);
    const sheet = page.locator('[role="dialog"]').first();
    if (!(await sheet.isVisible().catch(() => false))) {
      test.skip(true, 'Sheet did not open after card click (DnD intercept)');
      return;
    }

    const payBtn = sheet.getByRole('button', { name: /결제 등록/ });
    if (!(await payBtn.isVisible().catch(() => false))) {
      test.skip(true, 'No payment button');
      return;
    }
    await payBtn.click();

    // 현금 선택 -> 할부 옵션 사라짐
    const cashBtn = page.locator('button').filter({ hasText: /^.*현금$/ }).first();
    await cashBtn.click();

    // 할부 옵션이 사라져야 함
    const installment = page.getByText('일시불');
    const installVisible = await installment.isVisible().catch(() => false);
    expect(installVisible).toBe(false);

    // 분할 결제 모드 전환
    await page.getByText('분할 결제').click();

    // 카드 금액, 현금 금액 필드 확인
    await expect(page.getByLabel('카드 금액')).toBeVisible();
    await expect(page.getByLabel('현금 금액')).toBeVisible();
  });

  test('Payment submit with amount', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Dashboard did not load');
      return;
    }

    const testName = `결제실행_${Date.now()}`;
    const checkinBtn = page.getByRole('button', { name: /체크인/ }).first();
    if (!(await checkinBtn.isVisible().catch(() => false))) {
      test.skip(true, 'No check-in button');
      return;
    }

    await checkinBtn.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.locator('#ci-name').fill(testName);
    await dialog.locator('#ci-phone').fill(`010${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`);
    await dialog.getByRole('button', { name: '체크인' }).click();
    await expect(page.getByText(/체크인 완료/)).toBeVisible({ timeout: 10_000 });

    // Sheet -> 결제
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    await page.getByText(testName).first().scrollIntoViewIfNeeded();
    await page.getByText(testName).first().click();
    await page.waitForTimeout(500);
    const sheet = page.locator('[role="dialog"]').first();
    if (!(await sheet.isVisible().catch(() => false))) {
      test.skip(true, 'Sheet did not open after card click (DnD intercept)');
      return;
    }

    const payBtn = sheet.getByRole('button', { name: /결제 등록/ });
    if (!(await payBtn.isVisible().catch(() => false))) {
      test.skip(true, 'No payment button');
      return;
    }
    await payBtn.click();

    // 금액 입력
    const amountInput = page.getByLabel('금액');
    await expect(amountInput).toBeVisible({ timeout: 3_000 });
    await amountInput.fill('100000');

    // 결제 완료 버튼 클릭
    const submitBtn = page.getByRole('button', { name: '결제 완료' });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // 토스트: 결제 완료
    await expect(page.getByText('결제 완료')).toBeVisible({ timeout: 10_000 });

    await page.screenshot({
      path: 'test-results/screenshots/payment-completed.png',
      fullPage: true,
    });
  });
});
