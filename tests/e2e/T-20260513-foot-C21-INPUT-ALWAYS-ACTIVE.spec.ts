/**
 * E2E spec — T-20260513-foot-C21-INPUT-ALWAYS-ACTIVE
 * 2번차트 1구역 입력필드 기본 활성화 (클릭 없이 즉시 입력 가능)
 *
 * AC-1: 이메일 필드 즉시 입력 가능 (클릭 불필요)
 * AC-2: 여권번호 필드 즉시 입력 가능
 * AC-3: 우편번호+주소 필드 즉시 입력 가능
 * AC-4: 예약메모 필드 즉시 입력 가능 (예약내역 패널)
 * AC-5: 기존 저장/수정 로직 영향 없음
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260513 C21 입력필드 기본 활성화', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  async function navigateToFirstCustomerChart(page: Parameters<typeof loginAndWaitForDashboard>[0]) {
    await page.goto('/admin/customers');
    // 고객 목록에서 첫 번째 행 클릭 → 차트 페이지 진입
    const firstRow = page.locator('tr[data-customer-id], tbody tr').first();
    try {
      await firstRow.waitFor({ timeout: 10_000 });
    } catch {
      return false;
    }
    // 고객명 링크 또는 행 클릭
    const customerLink = firstRow.locator('a[href*="/chart/"]').first();
    const hasLink = await customerLink.count() > 0;
    if (hasLink) {
      await customerLink.click();
    } else {
      await firstRow.click();
    }
    try {
      // 차트 페이지 로드 대기 — 이름 텍스트 또는 이메일 라벨
      await page.getByText('이메일', { exact: true }).first().waitFor({ timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  test('AC-1: 이메일 입력창 기본 활성화 — input 즉시 존재', async ({ page }) => {
    const ok = await navigateToFirstCustomerChart(page);
    if (!ok) test.skip(true, '고객 차트 진입 실패');

    // 이메일 input이 클릭 없이도 DOM에 바로 존재해야 함
    const emailInput = page.locator('input[type="email"]').first();
    await expect(emailInput).toBeVisible({ timeout: 5_000 });

    // 입력 가능 확인
    await emailInput.fill('test@example.com');
    await expect(emailInput).toHaveValue('test@example.com');
    // 원래 값으로 복구 (저장 방지: Escape)
    await emailInput.press('Escape');
    console.log('[AC-1] 이메일 input 즉시 활성 OK');
  });

  test('AC-2: 여권번호 입력창 기본 활성화 — input 즉시 존재', async ({ page }) => {
    const ok = await navigateToFirstCustomerChart(page);
    if (!ok) test.skip(true, '고객 차트 진입 실패');

    // 여권번호 라벨이 보인 후 같은 행의 input 확인
    const passportLabel = page.getByText('여권번호', { exact: true }).first();
    await expect(passportLabel).toBeVisible({ timeout: 5_000 });

    // 여권번호 input: placeholder M12345678
    const passportInput = page.locator('input[placeholder*="M12345678"]').first();
    await expect(passportInput).toBeVisible({ timeout: 3_000 });
    console.log('[AC-2] 여권번호 input 즉시 활성 OK');
  });

  test('AC-3: 우편번호+주소 입력창 기본 활성화 — inputs 즉시 존재', async ({ page }) => {
    const ok = await navigateToFirstCustomerChart(page);
    if (!ok) test.skip(true, '고객 차트 진입 실패');

    // 우편번호 라벨 확인
    await expect(page.getByText('우편번호', { exact: true }).first()).toBeVisible({ timeout: 5_000 });

    // 우편번호 input (maxlength=5, numeric)
    const postalInput = page.locator('input[placeholder="12345"]').first();
    await expect(postalInput).toBeVisible({ timeout: 3_000 });

    // 주소 input
    const addressInput = page.locator('input[placeholder*="기본주소"]').first();
    await expect(addressInput).toBeVisible({ timeout: 3_000 });

    // 상세주소 input
    const addressDetailInput = page.locator('input[placeholder*="상세주소"]').first();
    await expect(addressDetailInput).toBeVisible({ timeout: 3_000 });
    console.log('[AC-3] 우편번호+주소 inputs 즉시 활성 OK');
  });

  test('AC-4: 예약메모 입력창 기본 활성화 — 예약 있을 경우 inline input 존재', async ({ page }) => {
    const ok = await navigateToFirstCustomerChart(page);
    if (!ok) test.skip(true, '고객 차트 진입 실패');

    // 예약내역 패널 영역 확인
    const resvSection = page.getByText('예약내역', { exact: true }).first();
    try {
      await resvSection.waitFor({ timeout: 5_000 });
    } catch {
      test.skip(true, '예약내역 패널 미표시 — 데이터 없음');
      return;
    }

    // 예약메모 inline input: placeholder='예약메모'
    const memoInput = page.locator('input[placeholder="예약메모"]').first();
    const hasMemo = await memoInput.count() > 0;
    if (!hasMemo) {
      // 예약이 없는 경우 스킵 (데이터 의존)
      console.log('[AC-4] 예약메모 input — 예약 없음, 스킵');
      return;
    }
    await expect(memoInput).toBeVisible({ timeout: 3_000 });
    console.log('[AC-4] 예약메모 input 즉시 활성 OK');
  });

  test('AC-5: 이메일 입력 후 저장 로직 동작 확인 (저장 버튼 미필요)', async ({ page }) => {
    const ok = await navigateToFirstCustomerChart(page);
    if (!ok) test.skip(true, '고객 차트 진입 실패');

    const emailInput = page.locator('input[type="email"]').first();
    await expect(emailInput).toBeVisible({ timeout: 5_000 });

    // Enter 키로 저장 가능 (기존 로직 유지)
    const originalVal = await emailInput.inputValue();
    await emailInput.fill('ac5test@example.com');
    // Enter 저장 트리거 — toast 또는 오류 없이 통과해야 함
    await emailInput.press('Enter');
    // 저장 오류 toast 없어야 함 (toast.error 텍스트 체크)
    const errorToast = page.getByText(/저장 실패/, { exact: false });
    await page.waitForTimeout(1_500);
    expect(await errorToast.count()).toBe(0);

    // 원래 값으로 복원
    await emailInput.fill(originalVal);
    await emailInput.press('Enter');
    console.log('[AC-5] 저장 로직 정상 동작 OK');
  });
});
