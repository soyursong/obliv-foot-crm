/**
 * T-20260520-foot-SELFCHECKIN-LEADSRC-COND: 셀프접수 유입경로 조건부 표시
 *
 * AC-1: "예약하고 왔어요" → 초진 → leadSource UI 미표시
 * AC-2: "예약하고 왔어요" → 재진 → leadSource UI 미표시
 * AC-3: "예약없이 방문했어요" → 안내창 → leadSource UI 기존대로 표시
 * AC-4: 예약 경로에서 leadSource 없이 접수 버튼 활성화 (워크인은 leadSource 필요)
 */
import { test, expect } from '@playwright/test';

test.describe('T-20260520 셀프접수 유입경로 조건부 표시', () => {
  test('AC-1: 예약 + 초진 → 유입경로 섹션 미표시', async ({ page }) => {
    await page.goto('/checkin/jongno-foot');
    await expect(page.getByText('셀프 접수')).toBeVisible({ timeout: 10_000 });

    // 예약하고 왔어요 선택
    await page.getByRole('button', { name: '예약하고 왔어요' }).click();
    // 초진 선택
    await page.locator('button').filter({ hasText: '초진' }).first().click();

    // 유입경로 버튼 미표시 확인
    await expect(page.getByRole('button', { name: 'SNS' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: '검색' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: '지인소개' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: '제휴' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: '기타' })).not.toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/leadsrc-cond-reserved-new.png',
      fullPage: true,
    });
  });

  test('AC-2: 예약 + 재진 → 유입경로 섹션 미표시', async ({ page }) => {
    await page.goto('/checkin/jongno-foot');
    await expect(page.getByText('셀프 접수')).toBeVisible({ timeout: 10_000 });

    // 예약하고 왔어요 선택
    await page.getByRole('button', { name: '예약하고 왔어요' }).click();
    // 재진 선택
    await page.locator('button').filter({ hasText: '재진' }).first().click();

    // 유입경로 버튼 미표시 확인
    await expect(page.getByRole('button', { name: 'SNS' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: '검색' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: '지인소개' })).not.toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/leadsrc-cond-reserved-returning.png',
      fullPage: true,
    });
  });

  test('AC-3: 워크인 → 유입경로 섹션 표시', async ({ page }) => {
    await page.goto('/checkin/jongno-foot');
    await expect(page.getByText('셀프 접수')).toBeVisible({ timeout: 10_000 });

    // 예약 없이 방문했어요 선택
    await page.getByRole('button', { name: '예약 없이 방문했어요' }).click();
    // 안내 팝업 확인
    await expect(page.getByText('당일 예약 상황에 따라')).toBeVisible({ timeout: 3_000 });
    // 팝업 확인 후 접수하기 클릭
    await page.getByRole('button', { name: '확인 후 접수하기' }).click();

    // 유입경로 섹션 표시 확인
    await expect(page.getByRole('button', { name: 'SNS' })).toBeVisible({ timeout: 2_000 });
    await expect(page.getByRole('button', { name: '검색' })).toBeVisible();
    await expect(page.getByRole('button', { name: '지인소개' })).toBeVisible();
    await expect(page.getByRole('button', { name: '제휴' })).toBeVisible();
    await expect(page.getByRole('button', { name: '기타' })).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/leadsrc-cond-walkin-shown.png',
      fullPage: true,
    });
  });

  test('AC-4a: 예약 + 재진 → leadSource 없이 접수 버튼 활성화', async ({ page }) => {
    await page.goto('/checkin/jongno-foot');
    await expect(page.getByText('셀프 접수')).toBeVisible({ timeout: 10_000 });

    // 이름 입력
    await page.locator('#sc-name').fill('유입경로조건테스트');
    // 전화번호 NumPad 입력
    for (const d of ['0', '1', '0', '5', '5', '5', '5', '6', '6', '6', '6']) {
      await page.getByRole('button', { name: d, exact: true }).click();
    }

    // 예약하고 왔어요 → 재진
    await page.getByRole('button', { name: '예약하고 왔어요' }).click();
    await page.locator('button').filter({ hasText: '재진' }).first().click();

    // leadSource 없이 접수 버튼 활성화 확인
    const submitBtn = page.getByRole('button', { name: '접수하기' });
    await expect(submitBtn).toBeEnabled();

    // 확인 화면에서 유입경로 항목 미표시
    await submitBtn.click();
    await expect(page.getByText('접수 정보 확인')).toBeVisible({ timeout: 5_000 });
    // 확인 화면에서 유입경로 라벨 표시 안됨 (예약 경로)
    const confirmContent = page.locator('.space-y-4.rounded-2xl');
    await expect(confirmContent.getByText('유입경로')).not.toBeVisible();
  });

  test('AC-4b: 워크인 → leadSource 없으면 접수 버튼 비활성', async ({ page }) => {
    await page.goto('/checkin/jongno-foot');
    await expect(page.getByText('셀프 접수')).toBeVisible({ timeout: 10_000 });

    // 이름 입력
    await page.locator('#sc-name').fill('워크인테스트');
    // 전화번호 NumPad 입력
    for (const d of ['0', '1', '0', '7', '7', '7', '7', '8', '8', '8', '8']) {
      await page.getByRole('button', { name: d, exact: true }).click();
    }

    // 예약 없이 방문했어요 → 팝업 확인
    await page.getByRole('button', { name: '예약 없이 방문했어요' }).click();
    await page.getByRole('button', { name: '확인 후 접수하기' }).click();

    // 방문유형(워크인) 완료, leadSource 미선택 → 비활성
    const submitBtn = page.getByRole('button', { name: '접수하기' });
    await expect(submitBtn).toBeDisabled();

    // leadSource 선택 → 활성화
    await page.getByRole('button', { name: '검색' }).click();
    await expect(submitBtn).toBeEnabled();
  });
});
