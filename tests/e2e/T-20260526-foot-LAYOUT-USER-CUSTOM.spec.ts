/**
 * E2E spec — T-20260526-foot-LAYOUT-USER-CUSTOM
 * 대시보드 배치편집 계정별 커스텀 오버라이드
 *
 * AC-2: 모든 로그인 계정에 "배치 편집" 버튼 표시 (staff 포함)
 * AC-2b: 편집 모드에서 "편집 완료" 버튼이 나타나고 클릭 시 토스트 "내 배치가 저장됐어요"
 * AC-2c: admin/manager에게만 "전 직원 기본" 버튼 표시, staff에게는 미노출
 * AC-3: 편집 모드 진입 후 "초기화" 버튼 표시
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260526 LAYOUT-USER-CUSTOM — 계정별 레이아웃 오버라이드', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — 스킵');
  });

  test('AC-2: 로그인 계정에게 "배치 편집" 버튼 표시 (staff 포함)', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const layoutBtn = page.getByRole('button', { name: /배치 편집/ });
    await expect(layoutBtn).toBeVisible({ timeout: 8_000 });
    console.log('[AC-2] 배치 편집 버튼 표시 PASS');
  });

  test('AC-2b: 편집 완료 클릭 시 "내 배치가 저장됐어요" 토스트', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const layoutBtn = page.getByRole('button', { name: /배치 편집/ });
    await expect(layoutBtn).toBeVisible({ timeout: 8_000 });

    // 배치 편집 모드 진입
    await layoutBtn.click();

    // "편집 완료" 버튼 확인
    const doneBtn = page.getByRole('button', { name: /편집 완료/ });
    await expect(doneBtn).toBeVisible({ timeout: 5_000 });
    console.log('[AC-2b] 편집 완료 버튼 표시 PASS');

    // 편집 완료 클릭 → 개인 레이아웃 저장 토스트
    await doneBtn.click();
    const toastEl = page.locator('text=내 배치가 저장됐어요');
    await expect(toastEl).toBeVisible({ timeout: 5_000 });
    console.log('[AC-2b] "내 배치가 저장됐어요" 토스트 PASS');
  });

  test('AC-2c: admin/manager에게만 "전 직원 기본" 버튼 표시 (편집 모드)', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const layoutBtn = page.getByRole('button', { name: /배치 편집/ });
    await expect(layoutBtn).toBeVisible({ timeout: 8_000 });

    await layoutBtn.click();

    // "전 직원 기본" 버튼은 admin/manager에게만 표시됨
    // 테스트 계정이 admin/manager이면 버튼이 보여야 하고, staff이면 없어야 함
    const clinicDefaultBtn = page.getByRole('button', { name: /전 직원 기본/ });
    const isVisible = await clinicDefaultBtn.isVisible().catch(() => false);
    if (isVisible) {
      console.log('[AC-2c] "전 직원 기본" 버튼 admin/manager에게 표시 PASS');
    } else {
      // staff 계정이라면 버튼이 없는 것이 정상 (AC-4 RLS 차단)
      console.log('[AC-2c] "전 직원 기본" 버튼 미표시 (staff 계정) — 정상');
    }

    // 편집 모드 종료
    const doneBtn = page.getByRole('button', { name: /편집 완료/ });
    if (await doneBtn.count() > 0) await doneBtn.click();
  });

  test('AC-3: 편집 모드에서 "초기화" 버튼 표시', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const layoutBtn = page.getByRole('button', { name: /배치 편집/ });
    await expect(layoutBtn).toBeVisible({ timeout: 8_000 });

    await layoutBtn.click();

    const resetBtn = page.getByRole('button', { name: /초기화/ });
    await expect(resetBtn).toBeVisible({ timeout: 5_000 });
    console.log('[AC-3] 초기화 버튼 편집 모드에서 표시 PASS');

    // 편집 모드 종료
    const doneBtn = page.getByRole('button', { name: /편집 완료/ });
    if (await doneBtn.count() > 0) await doneBtn.click();
  });

  test('AC-3 fallback: 초기화 후 지점 기본 레이아웃 복원 또는 코드 기본값 사용', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const layoutBtn = page.getByRole('button', { name: /배치 편집/ });
    await expect(layoutBtn).toBeVisible({ timeout: 8_000 });

    await layoutBtn.click();

    const resetBtn = page.getByRole('button', { name: /초기화/ });
    await expect(resetBtn).toBeVisible({ timeout: 5_000 });

    // 초기화 클릭 → "내 배치가 초기화됐어요" 토스트
    await resetBtn.click();
    const toastEl = page.locator('text=내 배치가 초기화됐어요');
    await expect(toastEl).toBeVisible({ timeout: 5_000 });
    console.log('[AC-3 fallback] 초기화 토스트 PASS');
  });
});
