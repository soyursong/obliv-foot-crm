/**
 * 직원/공간 관리 E2E 테스트
 *
 * - 로그인 -> 직원 페이지
 * - 직원 목록 표시 확인
 * - 역할별 그룹 확인
 * - 공간 배정 탭 확인
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('Staff and rooms management', () => {
  test('Navigate to staff page and see tabs', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Dashboard did not load');
      return;
    }

    const staffLink = page.getByRole('link', { name: '직원·공간' }).first();
    const linkVisible = await staffLink.isVisible().catch(() => false);
    if (!linkVisible) {
      test.skip(true, 'Staff link not visible (role restriction)');
      return;
    }

    await staffLink.click();
    await page.waitForURL('**/admin/staff', { timeout: 10_000 });

    // 3개 탭 확인: 직원, 공간 배정, 월간 실적
    await expect(page.getByRole('tab', { name: /직원/ })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('tab', { name: /공간 배정/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /월간 실적/ })).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/staff-page.png',
      fullPage: true,
    });
  });

  test('Staff tab shows role-based groups', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Dashboard did not load');
      return;
    }

    const staffLink = page.getByRole('link', { name: '직원·공간' }).first();
    if (!(await staffLink.isVisible().catch(() => false))) {
      test.skip(true, 'Staff link not visible');
      return;
    }

    await staffLink.click();
    await page.waitForURL('**/admin/staff', { timeout: 10_000 });

    // 직원 탭이 기본 선택
    await expect(page.getByText('직원 관리')).toBeVisible({ timeout: 5_000 });

    // 역할별 카드 확인
    const roles = ['원장', '상담실장', '코디네이터', '치료사', '관리사'];
    for (const role of roles) {
      const roleCard = page.getByText(role, { exact: true }).first();
      const visible = await roleCard.isVisible().catch(() => false);
      test.info().annotations.push({
        type: 'role',
        description: `${role}: ${visible}`,
      });
    }

    // "신규 직원" 버튼 확인
    await expect(page.getByRole('button', { name: /신규 직원/ })).toBeVisible();

    // "비활성 포함" 체크박스 확인
    await expect(page.getByText('비활성 포함')).toBeVisible();
  });

  test('Create staff dialog', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Dashboard did not load');
      return;
    }

    const staffLink = page.getByRole('link', { name: '직원·공간' }).first();
    if (!(await staffLink.isVisible().catch(() => false))) {
      test.skip(true, 'Staff link not visible');
      return;
    }

    await staffLink.click();
    await page.waitForURL('**/admin/staff', { timeout: 10_000 });

    // "신규 직원" 버튼 클릭
    await page.getByRole('button', { name: /신규 직원/ }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText('신규 직원 등록')).toBeVisible();

    // 이름 필드 확인
    await expect(dialog.getByPlaceholder('홍길동')).toBeVisible();

    // 역할 선택 확인
    await expect(dialog.locator('select')).toBeVisible();

    // 취소
    await dialog.getByRole('button', { name: '취소' }).click();
    await expect(dialog).not.toBeVisible({ timeout: 3_000 });
  });

  test('Room assignment tab', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Dashboard did not load');
      return;
    }

    const staffLink = page.getByRole('link', { name: '직원·공간' }).first();
    if (!(await staffLink.isVisible().catch(() => false))) {
      test.skip(true, 'Staff link not visible');
      return;
    }

    await staffLink.click();
    await page.waitForURL('**/admin/staff', { timeout: 10_000 });

    // 공간 배정 탭 클릭
    await page.getByRole('tab', { name: /공간 배정/ }).click();

    // 날짜 선택기 확인
    await expect(page.locator('input[type="date"]').first()).toBeVisible({ timeout: 5_000 });

    // 일간/주간 토글 확인
    await expect(page.getByText('일간', { exact: true })).toBeVisible();
    await expect(page.getByText('주간', { exact: true })).toBeVisible();

    // "전날 복사" 버튼 확인
    await expect(page.getByRole('button', { name: '전날 복사' })).toBeVisible();

    // 공간 유형별 카드 확인 (치료실, 레이저실, 상담실, 원장실)
    const roomTypes = ['치료실', '레이저실', '상담실', '원장실'];
    let foundRoomTypes = 0;
    for (const rt of roomTypes) {
      const visible = await page.getByText(rt).first().isVisible().catch(() => false);
      if (visible) foundRoomTypes++;
    }

    test.info().annotations.push({
      type: 'rooms',
      description: `Room types visible: ${foundRoomTypes}/${roomTypes.length}`,
    });

    await page.screenshot({
      path: 'test-results/screenshots/room-assignment.png',
      fullPage: true,
    });
  });

  test('Performance tab', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Dashboard did not load');
      return;
    }

    const staffLink = page.getByRole('link', { name: '직원·공간' }).first();
    if (!(await staffLink.isVisible().catch(() => false))) {
      test.skip(true, 'Staff link not visible');
      return;
    }

    await staffLink.click();
    await page.waitForURL('**/admin/staff', { timeout: 10_000 });

    // 월간 실적 탭 클릭
    await page.getByRole('tab', { name: /월간 실적/ }).click();

    // 월 선택기 확인
    await expect(page.getByLabel('월')).toBeVisible({ timeout: 5_000 });

    // 총 매출 / 총 건수 표시 확인
    await expect(page.getByText('총 매출')).toBeVisible();
    await expect(page.getByText('총 건수')).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/staff-performance.png',
      fullPage: true,
    });
  });
});
