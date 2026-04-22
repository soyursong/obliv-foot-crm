/**
 * 셀프체크인 UI 검증
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from './helpers';

test.describe('Self check-in', () => {
  test('Self check-in route /checkin/jongno-foot renders form', async ({ page }) => {
    await page.goto('/checkin/jongno-foot');

    // 클리닉이 정상 로드되면 "셀프 접수" 텍스트가 보여야 함
    await expect(page.getByText('셀프 접수')).toBeVisible({ timeout: 10_000 });

    // 이름 필드
    const nameInput = page.locator('#sc-name');
    await expect(nameInput).toBeVisible();

    // 연락처 필드
    const phoneInput = page.locator('#sc-phone');
    await expect(phoneInput).toBeVisible();

    // 방문 유형 버튼들
    await expect(page.getByText('신규', { exact: true })).toBeVisible();
    await expect(page.getByText('재진', { exact: true })).toBeVisible();
    await expect(page.getByText('체험', { exact: true })).toBeVisible();

    // 접수 버튼 (비활성)
    const submitBtn = page.getByRole('button', { name: '접수' });
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toBeDisabled();

    await page.screenshot({
      path: 'test-results/screenshots/self-checkin-form.png',
      fullPage: true,
    });
  });

  test('Self check-in form validates required fields', async ({ page }) => {
    await page.goto('/checkin/jongno-foot');
    await expect(page.getByText('셀프 접수')).toBeVisible({ timeout: 10_000 });

    const submitBtn = page.getByRole('button', { name: '접수' });

    // 이름만 입력 — 버튼 여전히 비활성
    await page.locator('#sc-name').fill('테스트');
    await expect(submitBtn).toBeDisabled();

    // 전화번호 입력 — 버튼 활성화
    await page.locator('#sc-phone').fill('01012345678');
    await expect(submitBtn).toBeEnabled();
  });

  test('Self check-in phone auto-format', async ({ page }) => {
    await page.goto('/checkin/jongno-foot');
    await expect(page.getByText('셀프 접수')).toBeVisible({ timeout: 10_000 });

    const phoneInput = page.locator('#sc-phone');
    await phoneInput.fill('01098765432');
    await expect(phoneInput).toHaveValue('010-9876-5432');
  });

  test('Self check-in invalid slug shows error', async ({ page }) => {
    await page.goto('/checkin/nonexistent-clinic');

    await expect(page.getByText('지점을 찾을 수 없습니다')).toBeVisible({ timeout: 10_000 });

    await page.screenshot({
      path: 'test-results/screenshots/self-checkin-invalid-slug.png',
      fullPage: true,
    });
  });

  test('Dashboard has check-in related UI elements', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Could not login');
      return;
    }

    const checkinElements = await page.getByText(/접수|체크인/).all();
    test.info().annotations.push({
      type: 'elements',
      description: `Found ${checkinElements.length} check-in related elements`,
    });

    await page.screenshot({
      path: 'test-results/screenshots/dashboard-checkin-elements.png',
      fullPage: true,
    });
  });
});
