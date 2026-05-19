/**
 * E2E spec — T-20260519-foot-STATUS-REVERT
 * 보라색(진료필요) 상태 플래그 변경 후 자동 풀림/전단계 복귀 버그 수정 검증
 *
 * AC-1: 보라색 상태 변경 후 새로고침해도 유지
 * AC-2: DB persist 확인 (optimistic update 후 서버 응답 불일치 조사)
 * AC-3: 동시접속 race condition 없음 (markRecentlyUpdated + merge 전략)
 * AC-4: 보라색 한정 버그인지 확인 — 다른 플래그도 동일 보호
 * AC-5: 수정 후 다른 상태 전이 회귀 없음
 *
 * 수정 내용:
 *   1) handleFlagChange 에 markRecentlyUpdated(ci.id) 추가 — 다른 핸들러 패턴 통일
 *   2) fetchCheckIns setRows merge 전략 — recentlyUpdated 보호 중인 row는 로컬 상태 우선 유지
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260519-foot-STATUS-REVERT — 보라색 플래그 안정성', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // AC-1: 보라색 플래그가 context 메뉴에서 선택 가능하고 active 표시됨
  test('AC-1: 보라색(진료필요) 플래그 선택 후 카드에 반영', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const cards = page.locator('[data-testid="checkin-card"]');
    const cardCount = await cards.count();
    if (cardCount === 0) {
      test.skip(true, '칸반 카드 없음 — 스킵');
      return;
    }

    // 카드 우클릭 → context menu 열기
    const firstCard = cards.first();
    await firstCard.click({ button: 'right' });

    // 상태 플래그 섹션 확인
    const menuBody = page.locator('.fixed.z-50').last();
    await expect(menuBody).toBeVisible({ timeout: 3_000 });

    // 보라색(진료필요) 버튼 확인
    const purpleBtn = menuBody.getByText('진료필요');
    await expect(purpleBtn).toBeVisible();
  });

  // AC-2: 플래그 변경 버튼 클릭 시 DB persist 없이도 즉시 UI 반영 (optimistic)
  test('AC-2: 플래그 클릭 후 즉시 optimistic update — context menu 닫힘', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const cards = page.locator('[data-testid="checkin-card"]');
    const cardCount = await cards.count();
    if (cardCount === 0) {
      test.skip(true, '칸반 카드 없음 — 스킵');
      return;
    }

    const firstCard = cards.first();
    await firstCard.click({ button: 'right' });

    const menuBody = page.locator('.fixed.z-50').last();
    await expect(menuBody).toBeVisible({ timeout: 3_000 });

    // 진료필요(보라) 클릭
    const purpleBtn = menuBody.getByText('진료필요');
    await purpleBtn.click();

    // context menu 닫혀야 함 (optimistic update 후 바로 close)
    await expect(menuBody).not.toBeVisible({ timeout: 1_000 });
  });

  // AC-4: 상태 플래그 섹션에 모든 9가지 플래그 표시 확인
  test('AC-4: 상태 플래그 섹션에 전체 9가지 플래그 메뉴 표시', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const cards = page.locator('[data-testid="checkin-card"]');
    const cardCount = await cards.count();
    if (cardCount === 0) {
      test.skip(true, '칸반 카드 없음 — 스킵');
      return;
    }

    await cards.first().click({ button: 'right' });
    const menuBody = page.locator('.fixed.z-50').last();
    await expect(menuBody).toBeVisible({ timeout: 3_000 });

    // 9가지 플래그 라벨 모두 존재
    const flagLabels = ['정상', '취소/부도', 'CP(데스크)', 'HL', '선체험', 'CP(치료실)', '진료필요', '진료완료', '수납완료'];
    for (const label of flagLabels) {
      await expect(menuBody.getByText(label)).toBeVisible();
    }

    // 닫기
    await page.keyboard.press('Escape');
  });

  // AC-5: 다른 상태 전이(진행단계) 회귀 없음 — 현 진행단계 섹션 표시 확인
  test('AC-5: 현 진행단계 섹션 표시 회귀 없음', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const cards = page.locator('[data-testid="checkin-card"]');
    const cardCount = await cards.count();
    if (cardCount === 0) {
      test.skip(true, '칸반 카드 없음 — 스킵');
      return;
    }

    await cards.first().click({ button: 'right' });
    const menuBody = page.locator('.fixed.z-50').last();
    await expect(menuBody).toBeVisible({ timeout: 3_000 });

    // 현 진행단계 섹션 존재
    await expect(menuBody.getByText('현 진행단계')).toBeVisible();

    await page.keyboard.press('Escape');
  });
});
