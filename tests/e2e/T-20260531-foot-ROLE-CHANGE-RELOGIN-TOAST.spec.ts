/**
 * E2E T-20260531-foot-ROLE-CHANGE-RELOGIN-TOAST
 * 직원 역할 변경 저장 토스트에 재로그인 안내 추가
 *
 * 배경: 역할 변경 시 RLS는 즉시 반영되나 FE 메모리 캐시(세션 user role)는
 *       재로그인/새로고침 전까지 미반영. "역할 바꿨는데 권한이 안 바뀐다" 혼란 예방.
 *
 * AC:
 * 1. 역할 변경 후 저장 → 성공 토스트에 "재로그인(또는 새로고침) 후 권한 적용" 안내 포함
 * 2. 기존 저장 로직(RLS 반영) 영향 없음 — 안내문만 추가
 *
 * 비파괴: 역할 변경 후 원래 역할로 복원한다.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const RELOGIN_NOTICE = /재로그인.*권한이 적용/;

test.describe('역할 변경 재로그인 안내 토스트 (T-20260531)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('역할 변경 저장 시 재로그인 안내 토스트 노출 + 원복', async ({ page }) => {
    await page.goto('/admin/accounts');
    await expect(page.getByRole('heading', { name: '계정 관리' })).toBeVisible({ timeout: 10_000 });

    // 첫 활성 계정 행의 "수정" 버튼
    const editButtons = page.getByRole('button', { name: '수정' });
    const count = await editButtons.count();
    if (count === 0) test.skip(true, '편집 가능한 활성 계정 없음');

    await editButtons.first().click();

    // 편집 모달 오픈 확인
    await expect(page.getByText(/계정 수정/)).toBeVisible({ timeout: 5_000 });

    // 역할 버튼 그리드: 현재 선택(teal)된 버튼 식별
    const roleButtons = page.locator('button.h-9.rounded-md.border.text-xs');
    const roleCount = await roleButtons.count();
    expect(roleCount).toBeGreaterThan(1);

    // 현재 선택된 버튼 인덱스 (teal 스타일)
    let selectedIdx = -1;
    for (let i = 0; i < roleCount; i++) {
      const cls = (await roleButtons.nth(i).getAttribute('class')) ?? '';
      if (cls.includes('border-teal-600')) { selectedIdx = i; break; }
    }
    expect(selectedIdx).toBeGreaterThanOrEqual(0);
    const originalLabel = (await roleButtons.nth(selectedIdx).textContent())?.trim() ?? '';

    // 다른 역할 버튼 선택
    const targetIdx = selectedIdx === 0 ? 1 : 0;
    await roleButtons.nth(targetIdx).click();

    // 저장 → 재로그인 안내 토스트 확인 (AC #1)
    await page.getByRole('button', { name: /^저장$/ }).click();
    await expect(page.getByText(RELOGIN_NOTICE)).toBeVisible({ timeout: 8_000 });
    console.log('[T-20260531] 재로그인 안내 토스트 노출 OK');

    // 원복: 다시 수정 모달 → 원래 역할로 되돌리고 저장
    await page.waitForTimeout(800);
    await editButtons.first().click();
    await expect(page.getByText(/계정 수정/)).toBeVisible({ timeout: 5_000 });
    const restoreBtn = page.locator('button.h-9.rounded-md.border.text-xs', { hasText: new RegExp(`^${originalLabel}$`) });
    await restoreBtn.first().click();
    await page.getByRole('button', { name: /^저장$/ }).click();
    await page.waitForTimeout(800);
    console.log('[T-20260531] 원래 역할 복원 OK', { originalLabel });
  });
});
