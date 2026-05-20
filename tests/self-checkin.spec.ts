/**
 * 셀프체크인 UI 검증
 *
 * [UPDATED for T-20260517-foot-CHECKIN-2STEP]
 * - 방문유형: 2단계 (1단계: 예약여부 / 2단계: 초진·재진)
 * - 유입경로: 대분류 5종 (SNS 선택 시 소분류 4종 추가)
 * - 전화번호: 온스크린 NumPad (sc-phone input 없음)
 * - canSubmit = 이름 + 전화(10+) + visitTypeComplete + leadSourceComplete
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

    // 연락처 표시 영역 (NumPad 기반 — input 아님)
    const phoneLbl = page.locator('label[for="sc-phone"]');
    await expect(phoneLbl).toBeVisible();

    // 방문 유형 버튼들 (T-20260517-foot-CHECKIN-2STEP: 2단계 구조)
    // 1단계: 예약여부 2버튼
    await expect(page.getByRole('button', { name: '예약하고 왔어요' })).toBeVisible();
    await expect(page.getByRole('button', { name: '예약 없이 방문했어요' })).toBeVisible();
    // 기존 평면 3버튼(초진/재진/예약없이 방문)은 더 이상 노출되지 않음
    await expect(page.getByRole('button', { name: '예약없이 방문', exact: true })).not.toBeVisible();

    // 접수하기 버튼 (비활성 — 이름·전화·visitType·leadSource 모두 필요)
    const submitBtn = page.getByRole('button', { name: '접수하기' });
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

    const submitBtn = page.getByRole('button', { name: '접수하기' });

    // 이름만 입력 — 여전히 비활성 (전화·visitType·leadSource 없음)
    await page.locator('#sc-name').fill('테스트');
    await expect(submitBtn).toBeDisabled();

    // 전화번호 NumPad 입력 — 여전히 비활성 (visitType·leadSource 없음)
    for (const d of ['0', '1', '0', '1', '2', '3', '4', '5', '6', '7', '8']) {
      await page.getByRole('button', { name: d, exact: true }).click();
    }
    await expect(submitBtn).toBeDisabled();

    // 방문유형 선택 — 여전히 비활성 (leadSource 없음)
    await page.getByRole('button', { name: '예약하고 왔어요' }).click();
    await page.locator('button').filter({ hasText: '재진' }).first().click();
    await expect(submitBtn).toBeDisabled();

    // 유입경로 선택 → 버튼 활성화
    await page.getByRole('button', { name: '검색' }).click();
    await expect(submitBtn).toBeEnabled();
  });

  test('Self check-in phone auto-format via NumPad', async ({ page }) => {
    await page.goto('/checkin/jongno-foot');
    await expect(page.getByText('셀프 접수')).toBeVisible({ timeout: 10_000 });

    // NumPad로 전화번호 입력
    for (const d of ['0', '1', '0', '9', '8', '7', '6', '5', '4', '3', '2']) {
      await page.getByRole('button', { name: d, exact: true }).click();
    }
    // 자동 포맷 표시 확인 (phone display span)
    await expect(page.getByText('010-9876-5432')).toBeVisible();
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
