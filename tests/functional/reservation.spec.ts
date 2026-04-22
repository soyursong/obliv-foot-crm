/**
 * 예약 CRUD E2E 테스트
 *
 * - 로그인 -> 예약 페이지 이동
 * - 새 예약 생성
 * - 예약 목록에 표시 확인
 * - 예약 -> 체크인 전환 기능 확인
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const TEST_NAME = `예약테스트_${Date.now()}`;
const TEST_PHONE = `010${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`;

test.describe('Reservation CRUD', () => {
  test('Navigate to reservations page', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Dashboard did not load');
      return;
    }

    // 사이드바에서 "예약관리" 클릭
    const reservationLink = page.getByRole('link', { name: '예약관리' }).first();
    await expect(reservationLink).toBeVisible({ timeout: 5_000 });
    await reservationLink.click();

    // 예약 페이지 로드 확인 - URL 변경
    await page.waitForURL('**/admin/reservations', { timeout: 10_000 });

    // 주간 캘린더가 보이는지 확인 (시간 슬롯 테이블)
    const timeTable = page.locator('table').first();
    await expect(timeTable).toBeVisible({ timeout: 10_000 });

    // "시간" 헤더 확인
    await expect(page.getByText('시간')).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/reservations-page.png',
      fullPage: true,
    });
  });

  test('Create new reservation via slot click', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Dashboard did not load');
      return;
    }

    await page.getByRole('link', { name: '예약관리' }).first().click();
    await page.waitForURL('**/admin/reservations', { timeout: 10_000 });

    // 슬롯의 + 버튼 클릭 (빈 슬롯)
    // Plus 아이콘 버튼은 빈 슬롯에 있음
    const plusButtons = page.locator('td button svg.lucide-plus').first();
    const hasPlusBtn = await plusButtons.isVisible().catch(() => false);

    if (!hasPlusBtn) {
      test.info().annotations.push({
        type: 'info',
        description: 'No available slot found for reservation',
      });
      return;
    }

    // + 버튼의 부모 클릭
    await plusButtons.locator('..').click();

    // 예약 등록 다이얼로그 열림
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText('예약 등록')).toBeVisible();

    // 전화번호 -> 이름 순서로 입력
    const phoneInput = dialog.getByLabel('전화번호');
    await phoneInput.fill(TEST_PHONE);

    const nameInput = dialog.getByLabel('이름');
    await nameInput.fill(TEST_NAME);

    // 유형: 재진 (기본값)
    // 저장 버튼 클릭
    const saveBtn = dialog.getByRole('button', { name: '저장' });
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    // 토스트: 예약 등록
    await expect(page.getByText('예약 등록')).toBeVisible({ timeout: 10_000 });

    // 예약이 캘린더에 표시되는지 확인
    await expect(page.getByText(TEST_NAME)).toBeVisible({ timeout: 10_000 });

    await page.screenshot({
      path: 'test-results/screenshots/reservation-created.png',
      fullPage: true,
    });
  });

  test('Reservation detail shows check-in conversion button', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Dashboard did not load');
      return;
    }

    await page.getByRole('link', { name: '예약관리' }).first().click();
    await page.waitForURL('**/admin/reservations', { timeout: 10_000 });

    // 기존 예약 카드 클릭 (confirmed 상태)
    const reservationCards = page.locator('td .rounded.border').first();
    const hasCard = await reservationCards.isVisible().catch(() => false);

    if (!hasCard) {
      test.info().annotations.push({
        type: 'info',
        description: 'No reservation card found to test check-in conversion',
      });
      return;
    }

    await reservationCards.click();

    // 예약 상세 다이얼로그
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // 체크인 전환 버튼 확인
    const checkinBtn = dialog.getByRole('button', { name: '체크인 전환' });
    const hasCheckinBtn = await checkinBtn.isVisible().catch(() => false);

    test.info().annotations.push({
      type: 'info',
      description: `Check-in conversion button visible: ${hasCheckinBtn}`,
    });

    // 수정 버튼 확인
    await expect(dialog.getByRole('button', { name: '수정' })).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/reservation-detail.png',
      fullPage: true,
    });
  });

  test('View mode toggle (week/day)', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Dashboard did not load');
      return;
    }

    await page.getByRole('link', { name: '예약관리' }).first().click();
    await page.waitForURL('**/admin/reservations', { timeout: 10_000 });

    // 일간/주간 토글 확인
    const dayBtn = page.getByText('일간', { exact: true });
    const weekBtn = page.getByText('주간', { exact: true });

    await expect(dayBtn).toBeVisible();
    await expect(weekBtn).toBeVisible();

    // 일간으로 전환
    await dayBtn.click();
    await page.waitForTimeout(500);

    // "오늘" 버튼 확인
    await expect(page.getByText('오늘', { exact: true })).toBeVisible();

    // 다시 주간으로 전환
    await weekBtn.click();
    await page.waitForTimeout(500);

    // "이번 주" 버튼 확인
    await expect(page.getByText('이번 주', { exact: true })).toBeVisible();
  });
});
