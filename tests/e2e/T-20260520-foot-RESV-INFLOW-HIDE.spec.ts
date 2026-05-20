/**
 * T-20260520-foot-RESV-INFLOW-HIDE: 예약 환자 체크인 시 유입경로 선택칸 조건부 제거
 *
 * 구현: SelfCheckIn.tsx — showLeadSource = (reservationType === 'walkin')
 *       커밋 8efed90 (T-20260520-foot-SELFCHECKIN-LEADSRC-COND) 로 완료
 *
 * AC-1: "예약하고 왔어요" → 초진 → 유입경로 선택칸 비노출
 * AC-2: "예약하고 왔어요" → 재진 → 유입경로 선택칸 비노출
 * AC-3: "예약없이 방문했어요" → 안내창 → 유입경로 선택칸 유지 (기존 동작 그대로)
 * AC-4: 회귀 없음 (워크인 유입경로 선택 필수 + 예약 환자는 미필요)
 */
import { test, expect } from '@playwright/test';

const CHECKIN_URL = '/checkin/jongno-foot';

test.describe('T-20260520-foot-RESV-INFLOW-HIDE — 예약 환자 유입경로 조건부 제거', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(CHECKIN_URL);
    await expect(page.getByText('셀프 접수')).toBeVisible({ timeout: 10_000 });
  });

  // ── AC-1: 예약 + 초진 → 유입경로 섹션 비노출 ──────────────────────────────
  test('AC-1: 예약 + 초진 → 유입경로 비노출', async ({ page }) => {
    await page.getByRole('button', { name: '예약하고 왔어요' }).click();
    await page.locator('button').filter({ hasText: '초진' }).first().click();

    // 유입경로 대분류 버튼 전체 미노출
    await expect(page.getByRole('button', { name: 'SNS' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: '검색' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: '지인소개' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: '제휴' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: '기타' })).not.toBeVisible();
    // 유입경로 섹션 제목도 미노출
    await expect(page.getByText('유입경로')).not.toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/resv-inflow-hide-reserved-new.png',
      fullPage: true,
    });
  });

  // ── AC-2: 예약 + 재진 → 유입경로 섹션 비노출 ──────────────────────────────
  test('AC-2: 예약 + 재진 → 유입경로 비노출', async ({ page }) => {
    await page.getByRole('button', { name: '예약하고 왔어요' }).click();
    await page.locator('button').filter({ hasText: '재진' }).first().click();

    await expect(page.getByRole('button', { name: 'SNS' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: '검색' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: '지인소개' })).not.toBeVisible();
    await expect(page.getByText('유입경로')).not.toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/resv-inflow-hide-reserved-returning.png',
      fullPage: true,
    });
  });

  // ── AC-3: 워크인 → 유입경로 섹션 정상 표시 ────────────────────────────────
  test('AC-3: 워크인 → 유입경로 표시 유지', async ({ page }) => {
    await page.getByRole('button', { name: '예약 없이 방문했어요' }).click();
    // 안내 팝업 확인
    await expect(page.getByText('당일 예약 상황에 따라')).toBeVisible({ timeout: 3_000 });
    await page.getByRole('button', { name: '확인 후 접수하기' }).click();

    // 유입경로 섹션 노출 확인
    await expect(page.getByText('유입경로')).toBeVisible({ timeout: 2_000 });
    await expect(page.getByRole('button', { name: 'SNS' })).toBeVisible();
    await expect(page.getByRole('button', { name: '검색' })).toBeVisible();
    await expect(page.getByRole('button', { name: '지인소개' })).toBeVisible();
    await expect(page.getByRole('button', { name: '제휴' })).toBeVisible();
    await expect(page.getByRole('button', { name: '기타' })).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/resv-inflow-hide-walkin-shown.png',
      fullPage: true,
    });
  });

  // ── AC-4a: 예약 + 재진 → leadSource 미선택으로 접수 버튼 활성화 ────────────
  test('AC-4a: 예약 + 재진 → leadSource 없이 접수 버튼 활성', async ({ page }) => {
    // 이름 입력
    await page.locator('#sc-name').fill('유입경로숨김테스트');
    // 전화번호 숫자패드 입력
    for (const d of ['0', '1', '0', '1', '2', '3', '4', '5', '6', '7', '8']) {
      await page.getByRole('button', { name: d, exact: true }).click();
    }

    await page.getByRole('button', { name: '예약하고 왔어요' }).click();
    await page.locator('button').filter({ hasText: '재진' }).first().click();

    // leadSource 없이 접수 버튼 활성화
    const submitBtn = page.getByRole('button', { name: '접수하기' });
    await expect(submitBtn).toBeEnabled();

    // 확인 화면에서도 유입경로 미표시
    await submitBtn.click();
    await expect(page.getByText('접수 정보 확인')).toBeVisible({ timeout: 5_000 });
    const confirmCard = page.locator('.space-y-4.rounded-2xl');
    await expect(confirmCard.getByText('유입경로')).not.toBeVisible();
  });

  // ── AC-4b: 워크인 → leadSource 미선택 시 접수 버튼 비활성 ──────────────────
  test('AC-4b: 워크인 → leadSource 미선택 시 접수 버튼 비활성', async ({ page }) => {
    await page.locator('#sc-name').fill('워크인유입필수테스트');
    for (const d of ['0', '1', '0', '9', '9', '9', '8', '8', '7', '7', '6']) {
      await page.getByRole('button', { name: d, exact: true }).click();
    }

    await page.getByRole('button', { name: '예약 없이 방문했어요' }).click();
    await page.getByRole('button', { name: '확인 후 접수하기' }).click();

    // leadSource 미선택 → 비활성
    const submitBtn = page.getByRole('button', { name: '접수하기' });
    await expect(submitBtn).toBeDisabled();

    // leadSource 선택 → 활성
    await page.getByRole('button', { name: '지인소개' }).click();
    await expect(submitBtn).toBeEnabled();
  });
});
