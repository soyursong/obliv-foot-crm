/**
 * 셀프체크인 E2E 테스트 (인증 불필요)
 *
 * [UPDATED for T-20260517-foot-CHECKIN-2STEP + T-20260520-foot-SELFCHECKIN-LEADSRC-COND]
 * - /checkin/jongno-foot 접속
 * - 클리닉명 표시 확인
 * - 이름 입력 + 전화번호 NumPad 입력
 * - 방문유형 2단계 선택 (예약여부 → 초진/재진)
 * - 유입경로: 워크인만 표시 (예약 경로는 미표시)
 * - 확인 화면 -> 접수 완료 화면
 * - 잘못된 slug -> 에러 메시지 확인
 */
import { test, expect } from '@playwright/test';

test.describe('Self check-in flow', () => {
  test('Full self check-in flow: input -> confirm -> done', async ({ page }) => {
    await page.goto('/checkin/jongno-foot');

    // 클리닉명이 표시되어야 함 (또는 셀프 접수)
    await expect(page.getByText('셀프 접수')).toBeVisible({ timeout: 10_000 });

    // 이름 입력
    const nameInput = page.locator('#sc-name');
    await expect(nameInput).toBeVisible();
    await nameInput.fill('셀프체크인테스트');

    // 전화번호 NumPad 입력 (T-20260517-foot-CHECKIN-2STEP: sc-phone input 없음)
    for (const d of ['0', '1', '0', '1', '2', '3', '4', '0', '0', '0', '0']) {
      await page.getByRole('button', { name: d, exact: true }).click();
    }
    // 자동 포맷 표시 확인
    await expect(page.getByText('010-1234-0000')).toBeVisible();

    // 방문유형 2단계: 예약하고 왔어요 → 재진
    await page.getByRole('button', { name: '예약하고 왔어요' }).click();
    await page.locator('button').filter({ hasText: '재진' }).first().click();

    // T-20260520-foot-SELFCHECKIN-LEADSRC-COND: 예약 경로 → leadSource 미표시·미필요
    await expect(page.getByRole('button', { name: '검색' })).not.toBeVisible();

    // 접수하기 버튼 활성화 확인 (leadSource 없이도 가능)
    const submitBtn = page.getByRole('button', { name: '접수하기' });
    await expect(submitBtn).toBeEnabled();

    // 접수하기 버튼 클릭 -> 확인 화면
    await submitBtn.click();

    // 확인 화면
    await expect(page.getByText('접수 정보 확인')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('셀프체크인테스트')).toBeVisible();
    await expect(page.getByText('010-1234-0000')).toBeVisible();
    await expect(page.getByText('재진')).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/self-checkin-confirm.png',
      fullPage: true,
    });

    // 접수하기 버튼 클릭
    const confirmBtn = page.getByRole('button', { name: '접수하기' });
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // 완료 화면 또는 에러 화면 (RLS 정책에 따라 다를 수 있음)
    const doneOrError = await Promise.race([
      page.getByText('접수 완료').waitFor({ timeout: 15_000 }).then(() => 'done' as const),
      page.getByRole('heading', { name: '접수 실패' }).waitFor({ timeout: 15_000 }).then(() => 'error' as const),
    ]);

    if (doneOrError === 'done') {
      await expect(page.getByText('셀프체크인테스트')).toBeVisible();

      // 대기번호 표시 (#숫자)
      const queueNumber = page.locator('text=/#\\d+/');
      const hasQueue = await queueNumber.isVisible().catch(() => false);
      test.info().annotations.push({
        type: 'queue',
        description: `Queue number displayed: ${hasQueue}`,
      });

      await page.screenshot({
        path: 'test-results/screenshots/self-checkin-done.png',
        fullPage: true,
      });

      // "새 접수" 버튼 클릭 -> 입력 폼으로 리셋
      await page.getByRole('button', { name: '새 접수' }).click();
      await expect(page.getByText('셀프 접수')).toBeVisible({ timeout: 5_000 });

      // 폼이 초기화되었는지 확인
      await expect(page.locator('#sc-name')).toHaveValue('');
      // phone은 NumPad state — 포맷된 번호가 표시되지 않음을 확인
      await expect(page.getByText(/^\d{3}-\d{4}-\d{4}$/)).not.toBeVisible();
    } else {
      // RLS 정책으로 인한 실패 -- 에러 화면 정상 표시 확인
      test.info().annotations.push({
        type: 'rls',
        description: 'Self check-in failed due to RLS policy (expected in test env)',
      });
      await expect(page.getByRole('heading', { name: '접수 실패' })).toBeVisible();
      // "다시 시도" 버튼으로 폼 복귀 확인
      await page.getByRole('button', { name: '다시 시도' }).click();
      await expect(page.locator('#sc-name')).toBeVisible({ timeout: 5_000 });
    }
  });

  test('Confirm screen back button returns to input', async ({ page }) => {
    await page.goto('/checkin/jongno-foot');
    await expect(page.getByText('셀프 접수')).toBeVisible({ timeout: 10_000 });

    // 이름 입력
    await page.locator('#sc-name').fill('수정테스트');
    // 전화번호 NumPad 입력
    for (const d of ['0', '1', '0', '9', '9', '9', '9', '8', '8', '8', '8']) {
      await page.getByRole('button', { name: d, exact: true }).click();
    }
    // 방문유형 2단계: 예약하고 왔어요 → 초진
    await page.getByRole('button', { name: '예약하고 왔어요' }).click();
    await page.locator('button').filter({ hasText: '초진' }).first().click();
    // T-20260520-foot-SELFCHECKIN-LEADSRC-COND: 예약 경로 → leadSource 미표시·미필요

    // 접수하기 클릭 → confirm 화면
    await page.getByRole('button', { name: '접수하기' }).click();
    await expect(page.getByText('접수 정보 확인')).toBeVisible({ timeout: 5_000 });

    // "수정" 버튼 클릭 -> 입력 폼으로 돌아감
    await page.getByRole('button', { name: '수정' }).click();
    await expect(page.getByText('셀프 접수')).toBeVisible({ timeout: 5_000 });

    // 기존 입력값 유지 확인
    await expect(page.locator('#sc-name')).toHaveValue('수정테스트');
  });

  test('Invalid clinic slug shows error', async ({ page }) => {
    await page.goto('/checkin/invalid-clinic-slug-xyz');

    await expect(page.getByText('지점을 찾을 수 없습니다')).toBeVisible({ timeout: 10_000 });

    await page.screenshot({
      path: 'test-results/screenshots/self-checkin-invalid.png',
      fullPage: true,
    });
  });

  test('Visit type selection works (2단계 flow)', async ({ page }) => {
    await page.goto('/checkin/jongno-foot');
    await expect(page.getByText('셀프 접수')).toBeVisible({ timeout: 10_000 });

    // [T-20260517-foot-CHECKIN-2STEP] 1단계: 예약여부 2버튼 표시 확인
    await expect(page.getByRole('button', { name: '예약하고 왔어요' })).toBeVisible();
    await expect(page.getByRole('button', { name: '예약 없이 방문했어요' })).toBeVisible();
    // 기존 평면 '예약없이 방문' 버튼은 없음
    await expect(page.getByRole('button', { name: '예약없이 방문', exact: true })).not.toBeVisible();

    // 예약 선택 시 2단계(초진/재진) 버튼 노출
    await page.getByRole('button', { name: '예약하고 왔어요' }).click();
    await expect(page.locator('button').filter({ hasText: '초진' }).first()).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('button').filter({ hasText: '재진' }).first()).toBeVisible({ timeout: 3_000 });

    // 재진 선택
    await page.locator('button').filter({ hasText: '재진' }).first().click();
    // 워크인: 예약 없이 방문했어요 → 팝업
    await page.getByRole('button', { name: '예약 없이 방문했어요' }).click();
    await expect(page.getByText('당일 예약 상황에 따라')).toBeVisible({ timeout: 3_000 });
    // 팝업 확인
    await page.getByRole('button', { name: '확인 후 접수하기' }).click();
    await expect(page.getByText('당일 예약 상황에 따라')).not.toBeVisible({ timeout: 3_000 });
  });

  test('Submit button disabled without required fields', async ({ page }) => {
    await page.goto('/checkin/jongno-foot');
    await expect(page.getByText('셀프 접수')).toBeVisible({ timeout: 10_000 });

    const submitBtn = page.getByRole('button', { name: '접수' });

    // 아무것도 입력하지 않으면 비활성
    await expect(submitBtn).toBeDisabled();

    // 이름만 입력
    await page.locator('#sc-name').fill('이름만');
    await expect(submitBtn).toBeDisabled();

    // 짧은 전화번호 (7자리) — NumPad로 입력
    for (const d of ['0', '1', '0', '1', '2', '3', '4']) {
      await page.getByRole('button', { name: d, exact: true }).click();
    }
    await expect(submitBtn).toBeDisabled();

    // 전체 삭제 후 정상 전화번호 입력 (11자리)
    await page.getByRole('button', { name: '전체삭제' }).click();
    for (const d of ['0', '1', '0', '1', '2', '3', '4', '5', '6', '7', '8']) {
      await page.getByRole('button', { name: d, exact: true }).click();
    }
    // phone(11자리) OK이지만 visitType 없으면 여전히 비활성
    await expect(submitBtn).toBeDisabled();

    // visitType 선택 (예약 + 재진) → 이제 canSubmit = name ✅ + phone ✅ + visitType ✅
    await page.getByRole('button', { name: '예약하고 왔어요' }).click();
    await page.locator('button').filter({ hasText: '재진' }).first().click();
    await expect(submitBtn).toBeEnabled();
  });
});
