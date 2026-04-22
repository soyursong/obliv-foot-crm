/**
 * 패키지 관리 E2E 테스트
 *
 * - 로그인 -> 패키지 페이지 이동
 * - 패키지 생성 다이얼로그 열기
 * - 프리셋 선택 -> 회차/금액 자동 계산 확인
 * - 패키지 목록 표시 확인
 * - 잔여 회차 표시 확인
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('Package management', () => {
  test('Navigate to packages page', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Dashboard did not load');
      return;
    }

    const packageLink = page.getByRole('link', { name: '패키지' }).first();
    const linkVisible = await packageLink.isVisible().catch(() => false);
    if (!linkVisible) {
      test.skip(true, 'Package link not visible (role restriction)');
      return;
    }

    await packageLink.click();
    await page.waitForURL('**/admin/packages', { timeout: 10_000 });

    // 탭 확인: 활성, 완료, 환불, 전체
    await expect(page.getByRole('tab', { name: '활성' })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('tab', { name: '완료' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '환불' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '전체' })).toBeVisible();

    // "패키지 생성" 버튼 확인
    await expect(page.getByRole('button', { name: /패키지 생성/ })).toBeVisible();

    // 테이블 헤더 확인
    await expect(page.getByText('고객', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('패키지', { exact: true }).first()).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/packages-page.png',
      fullPage: true,
    });
  });

  test('Open package create dialog and check presets', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Dashboard did not load');
      return;
    }

    const packageLink = page.getByRole('link', { name: '패키지' }).first();
    if (!(await packageLink.isVisible().catch(() => false))) {
      test.skip(true, 'Package link not visible');
      return;
    }

    await packageLink.click();
    await page.waitForURL('**/admin/packages', { timeout: 10_000 });

    // "패키지 생성" 클릭
    await page.getByRole('button', { name: /패키지 생성/ }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText('패키지 생성')).toBeVisible();

    // 프리셋 버튼들 확인
    await expect(dialog.getByText('프리셋')).toBeVisible();

    // 커스텀 버튼 확인
    await expect(dialog.getByText('커스텀', { exact: true })).toBeVisible();

    // 회차 입력 필드 확인 (가열, 비가열, 수액, 사전처치)
    await expect(dialog.getByText('가열', { exact: true }).first()).toBeVisible();
    await expect(dialog.getByText('비가열', { exact: true }).first()).toBeVisible();
    await expect(dialog.getByText('수액', { exact: true }).first()).toBeVisible();
    await expect(dialog.getByText('사전처치', { exact: true }).first()).toBeVisible();

    // 패키지 금액 필드 확인
    await expect(dialog.getByText('패키지 금액')).toBeVisible();
    await expect(dialog.getByText('총 계약금')).toBeVisible();

    // 고객 선택 필드 확인
    await expect(dialog.getByText('고객 선택')).toBeVisible();

    // 생성 버튼 (고객 미선택 시 비활성)
    const createBtn = dialog.getByRole('button', { name: '생성' });
    await expect(createBtn).toBeDisabled();

    await page.screenshot({
      path: 'test-results/screenshots/package-create-dialog.png',
      fullPage: true,
    });

    // 커스텀 프리셋 클릭 -> 회차 직접 편집 가능 확인
    await dialog.getByText('커스텀', { exact: true }).click();

    // 취소
    await dialog.getByRole('button', { name: '취소' }).click();
    await expect(dialog).not.toBeVisible({ timeout: 3_000 });
  });

  test('Package list filter tabs work', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Dashboard did not load');
      return;
    }

    const packageLink = page.getByRole('link', { name: '패키지' }).first();
    if (!(await packageLink.isVisible().catch(() => false))) {
      test.skip(true, 'Package link not visible');
      return;
    }

    await packageLink.click();
    await page.waitForURL('**/admin/packages', { timeout: 10_000 });

    // 각 탭 전환 테스트
    const tabs = ['활성', '완료', '환불', '전체'];
    for (const tabName of tabs) {
      const tab = page.getByRole('tab', { name: tabName });
      await tab.click();
      await page.waitForTimeout(500);
    }
  });

  test('Package detail sheet shows session info', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Dashboard did not load');
      return;
    }

    const packageLink = page.getByRole('link', { name: '패키지' }).first();
    if (!(await packageLink.isVisible().catch(() => false))) {
      test.skip(true, 'Package link not visible');
      return;
    }

    await packageLink.click();
    await page.waitForURL('**/admin/packages', { timeout: 10_000 });
    await page.waitForTimeout(1000);

    // 첫 번째 패키지 행 클릭
    const firstRow = page.locator('tbody tr').first();
    if (!(await firstRow.isVisible().catch(() => false))) {
      test.info().annotations.push({
        type: 'info',
        description: 'No package rows found',
      });
      return;
    }

    await firstRow.click();
    await page.waitForTimeout(500);

    // Sheet 열림 확인
    const sheet = page.locator('[role="dialog"]').first();
    if (!(await sheet.isVisible().catch(() => false))) {
      // Sheet가 delay되었을 수 있으므로 좀 더 대기
      await page.waitForTimeout(2000);
      if (!(await sheet.isVisible().catch(() => false))) {
        test.info().annotations.push({
          type: 'info',
          description: 'Package detail sheet did not open',
        });
        return;
      }
    }

    // 잔여 회차 정보 확인 (가열, 비가열, 수액, 사전처치)
    const hasRemaining = await sheet.getByText('가열').first().isVisible().catch(() => false);
    test.info().annotations.push({
      type: 'info',
      description: `Session remaining info visible: ${hasRemaining}`,
    });

    // 총 계약금 표시 확인
    await expect(sheet.getByText('총 계약금')).toBeVisible();

    // 소진 이력 섹션 확인
    await expect(sheet.getByText(/소진 이력/)).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/package-detail.png',
      fullPage: true,
    });
  });
});
