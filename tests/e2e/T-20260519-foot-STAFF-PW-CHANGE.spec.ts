/**
 * E2E spec — T-20260519-foot-STAFF-PW-CHANGE
 * 스태프 셀프 비밀번호 변경 UI
 *
 * AC-1: 사이드바 하단 "비밀번호 변경" 버튼 — 모든 역할 노출
 * AC-2: 현재 PW → 새 PW → 확인 폼 렌더링
 * AC-3: 유효성 검사 — 8자 미만, 숫자 누락, 확인 불일치 오류 토스트
 * AC-4: 성공 시 토스트 노출 + 다이얼로그 닫힘
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260519-foot-STAFF-PW-CHANGE — 셀프 비밀번호 변경 UI', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  test('AC-1: 사이드바 "비밀번호 변경" 버튼 노출', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // 데스크탑 사이드바 기준 — 사이드바 확장 상태여야 함
    // 축소돼 있으면 버튼 클릭으로 펼치기
    const toggleBtn = page.getByTestId('sidebar-toggle');
    if (await toggleBtn.isVisible()) {
      const sidebar = page.getByTestId('desktop-sidebar');
      const sidebarClass = await sidebar.getAttribute('class') ?? '';
      if (sidebarClass.includes('w-10')) {
        await toggleBtn.click();
        await page.waitForTimeout(300);
      }
    }

    const pwBtn = page.getByRole('button', { name: '비밀번호 변경' });
    await expect(pwBtn.first()).toBeVisible();
  });

  test('AC-2: 비밀번호 변경 다이얼로그 — 3개 필드 렌더링', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // 사이드바 확장 보장
    const toggleBtn = page.getByTestId('sidebar-toggle');
    if (await toggleBtn.isVisible()) {
      const sidebar = page.getByTestId('desktop-sidebar');
      const sidebarClass = await sidebar.getAttribute('class') ?? '';
      if (sidebarClass.includes('w-10')) {
        await toggleBtn.click();
        await page.waitForTimeout(300);
      }
    }

    // 다이얼로그 열기
    await page.getByRole('button', { name: '비밀번호 변경' }).first().click();

    await expect(page.getByLabel('현재 비밀번호')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByLabel('새 비밀번호')).toBeVisible();
    await expect(page.getByLabel('새 비밀번호 확인')).toBeVisible();
    await expect(page.getByRole('button', { name: '변경 저장' })).toBeVisible();
    await expect(page.getByRole('button', { name: '취소' })).toBeVisible();
  });

  test('AC-3-a: 새 PW 8자 미만 — 유효성 오류', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const toggleBtn = page.getByTestId('sidebar-toggle');
    if (await toggleBtn.isVisible()) {
      const sidebar = page.getByTestId('desktop-sidebar');
      const sidebarClass = await sidebar.getAttribute('class') ?? '';
      if (sidebarClass.includes('w-10')) {
        await toggleBtn.click();
        await page.waitForTimeout(300);
      }
    }

    await page.getByRole('button', { name: '비밀번호 변경' }).first().click();
    await page.getByLabel('현재 비밀번호').fill('anypassword');
    await page.getByLabel('새 비밀번호').fill('abc1'); // 4자
    await page.getByLabel('새 비밀번호 확인').fill('abc1');
    await page.getByRole('button', { name: '변경 저장' }).click();

    // 토스트 오류 메시지 확인
    await expect(page.getByText('비밀번호는 최소 8자 이상이어야 합니다.')).toBeVisible({ timeout: 5_000 });
  });

  test('AC-3-b: 새 PW 확인 불일치 — 오류', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const toggleBtn = page.getByTestId('sidebar-toggle');
    if (await toggleBtn.isVisible()) {
      const sidebar = page.getByTestId('desktop-sidebar');
      const sidebarClass = await sidebar.getAttribute('class') ?? '';
      if (sidebarClass.includes('w-10')) {
        await toggleBtn.click();
        await page.waitForTimeout(300);
      }
    }

    await page.getByRole('button', { name: '비밀번호 변경' }).first().click();
    await page.getByLabel('현재 비밀번호').fill('anypassword');
    await page.getByLabel('새 비밀번호').fill('NewPass123');
    await page.getByLabel('새 비밀번호 확인').fill('Different99');
    await page.getByRole('button', { name: '변경 저장' }).click();

    await expect(page.getByText('새 비밀번호와 확인 비밀번호가 일치하지 않습니다.')).toBeVisible({ timeout: 5_000 });
  });

  test('AC-3-c: 새 PW 숫자 미포함 — 오류', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const toggleBtn = page.getByTestId('sidebar-toggle');
    if (await toggleBtn.isVisible()) {
      const sidebar = page.getByTestId('desktop-sidebar');
      const sidebarClass = await sidebar.getAttribute('class') ?? '';
      if (sidebarClass.includes('w-10')) {
        await toggleBtn.click();
        await page.waitForTimeout(300);
      }
    }

    await page.getByRole('button', { name: '비밀번호 변경' }).first().click();
    await page.getByLabel('현재 비밀번호').fill('anypassword');
    await page.getByLabel('새 비밀번호').fill('alphabetonly');
    await page.getByLabel('새 비밀번호 확인').fill('alphabetonly');
    await page.getByRole('button', { name: '변경 저장' }).click();

    await expect(page.getByText('숫자를 1자 이상 포함해야 합니다.')).toBeVisible({ timeout: 5_000 });
  });

  test('AC-2: 취소 버튼 — 다이얼로그 닫힘', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const toggleBtn = page.getByTestId('sidebar-toggle');
    if (await toggleBtn.isVisible()) {
      const sidebar = page.getByTestId('desktop-sidebar');
      const sidebarClass = await sidebar.getAttribute('class') ?? '';
      if (sidebarClass.includes('w-10')) {
        await toggleBtn.click();
        await page.waitForTimeout(300);
      }
    }

    await page.getByRole('button', { name: '비밀번호 변경' }).first().click();
    await expect(page.getByLabel('현재 비밀번호')).toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: '취소' }).click();
    await expect(page.getByLabel('현재 비밀번호')).not.toBeVisible({ timeout: 3_000 });
  });
});
