/**
 * E2E — T-20260524-foot-DESIG-SAVE-ERR
 * 지정 치료사 저장 에러 수정 regression
 *
 * 근본 원인: customers.designated_therapist_id 컬럼 미존재 → DB 직접 적용으로 수정
 *
 * SC-1: 2번차트 [지정 치료사] 드롭다운이 정상 렌더되고 저장 에러가 없다
 * SC-2: 드롭다운 선택 후 "저장 실패" 토스트가 아닌 "지정 치료사: {이름}" 성공 토스트
 * SC-3: 페이지 새로고침 후 저장된 값이 유지된다 (DB 반영 검증)
 * SC-4: 지정 치료사 없음 선택 시 에러 없이 해제 성공
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const SKIP_NO_SEED = !process.env.PLAYWRIGHT_SEED_CUSTOMER_ID;

test.describe('T-20260524-foot-DESIG-SAVE-ERR — 저장 에러 수정 regression', () => {

  // SC-1: 드롭다운 렌더 + 저장 에러 미노출
  test('SC-1: 지정 치료사 드롭다운 렌더 정상 — 에러 없음', async ({ page }) => {
    test.skip(SKIP_NO_SEED, '시드 데이터 없음 — CI skip');

    const customerId = process.env.PLAYWRIGHT_SEED_CUSTOMER_ID!;
    await page.goto(`${BASE_URL}/chart/${customerId}`);
    await page.waitForLoadState('networkidle');

    const select = page.getByTestId('designated-therapist-select');
    await expect(select).toBeVisible({ timeout: 10_000 });

    // 에러 토스트가 페이지 진입 시 나타나면 안 됨
    const errorToast = page.getByText(/저장 실패/);
    await expect(errorToast).not.toBeVisible();
  });

  // SC-2: 저장 성공 토스트 (에러 토스트 아님)
  test('SC-2: 지정 치료사 변경 시 성공 토스트 (저장 실패 아님)', async ({ page }) => {
    test.skip(SKIP_NO_SEED, '시드 데이터 없음 — CI skip');

    const customerId = process.env.PLAYWRIGHT_SEED_CUSTOMER_ID!;
    await page.goto(`${BASE_URL}/chart/${customerId}`);
    await page.waitForLoadState('networkidle');

    const select = page.getByTestId('designated-therapist-select');
    await expect(select).toBeVisible({ timeout: 10_000 });

    const options = await select.locator('option').all();
    if (options.length < 2) {
      test.skip(); // 치료사 없으면 skip
      return;
    }

    const secondOption = options[1];
    const optionValue = await secondOption.getAttribute('value');
    await select.selectOption(optionValue!);

    // 실패 토스트가 없어야 함
    const failToast = page.getByText(/저장 실패/);
    await expect(failToast).not.toBeVisible({ timeout: 3_000 });

    // 성공 토스트가 노출되어야 함
    await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 5_000 });
  });

  // SC-3: 저장 후 새로고침 → 값 유지 (DB 반영 검증)
  test('SC-3: 저장 후 새로고침 시 값 유지 — DB 반영 확인', async ({ page }) => {
    test.skip(SKIP_NO_SEED, '시드 데이터 없음 — CI skip');

    const customerId = process.env.PLAYWRIGHT_SEED_CUSTOMER_ID!;
    await page.goto(`${BASE_URL}/chart/${customerId}`);
    await page.waitForLoadState('networkidle');

    const select = page.getByTestId('designated-therapist-select');
    await expect(select).toBeVisible({ timeout: 10_000 });

    const options = await select.locator('option').all();
    if (options.length < 2) { test.skip(); return; }

    const secondValue = await options[1].getAttribute('value');
    await select.selectOption(secondValue!);
    await page.waitForTimeout(1500);

    // 새로고침 후 값 유지 확인
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('designated-therapist-select'))
      .toHaveValue(secondValue!, { timeout: 8_000 });
  });

  // SC-4: 지정 치료사 해제 — 에러 없이 성공
  test('SC-4: 지정 치료사 없음 설정 시 에러 없이 해제 성공', async ({ page }) => {
    test.skip(SKIP_NO_SEED, '시드 데이터 없음 — CI skip');

    const customerId = process.env.PLAYWRIGHT_SEED_CUSTOMER_ID!;
    await page.goto(`${BASE_URL}/chart/${customerId}`);
    await page.waitForLoadState('networkidle');

    const select = page.getByTestId('designated-therapist-select');
    await expect(select).toBeVisible({ timeout: 10_000 });

    await select.selectOption('');

    const failToast = page.getByText(/저장 실패/);
    await expect(failToast).not.toBeVisible({ timeout: 3_000 });

    await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('지정 치료사 해제')).toBeVisible({ timeout: 3_000 });
  });

});
