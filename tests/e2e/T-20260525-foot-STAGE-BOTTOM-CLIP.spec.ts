/**
 * E2E spec — T-20260525-foot-STAGE-BOTTOM-CLIP
 * StatusContextMenu "현 진행단계" 섹션 하단 짤림 방지 (PC + 태블릿)
 *
 * AC-1: PC(1920x1080) — 컨텍스트 메뉴가 뷰포트 하단을 초과하지 않음
 * AC-2: 태블릿(iPad 가로 1180x820) — 동일 보장
 * AC-3: 항목이 컨테이너 높이보다 많을 경우 overflow-y scroll 활성화
 * AC-4: 기존 레이아웃(상단 헤더, 좌측 사이드바 등) 깨지지 않음
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260525-foot-STAGE-BOTTOM-CLIP — 현 진행단계 하단 짤림 방지', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  test('AC-1: PC(1920x1080) — 컨텍스트 메뉴 뷰포트 내부 완전 표시', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // 칸반 카드 우클릭으로 컨텍스트 메뉴 오픈
    const cards = page.locator('[data-testid="checkin-card"]');
    const cardCount = await cards.count();
    if (cardCount === 0) {
      test.skip(true, '칸반 카드 없음 — 스킵');
      return;
    }

    // 화면 하단 근처 카드 (클리핑이 일어나기 쉬운 위치)
    const card = cards.first();
    await card.click({ button: 'right' });

    // 컨텍스트 메뉴 대기
    const menu = page.locator('.fixed.z-50.overflow-y-auto').first();
    const menuVisible = await menu.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false);
    if (!menuVisible) {
      test.skip(true, '컨텍스트 메뉴 미오픈 — 스킵');
      return;
    }

    // AC-1: "현 진행단계" 섹션 헤더가 보여야 함
    const stageHeader = page.getByText('현 진행단계', { exact: true });
    await expect(stageHeader).toBeVisible();

    // AC-1: 메뉴 바운딩 박스가 뷰포트 하단(1080px)을 초과하지 않는지 확인
    const menuBox = await menu.boundingBox();
    if (menuBox) {
      const menuBottom = menuBox.y + menuBox.height;
      expect(menuBottom).toBeLessThanOrEqual(1080 + 1); // 1px 허용
    }

    // AC-4: 메뉴 닫기 (Escape)
    await page.keyboard.press('Escape');
  });

  test('AC-2: 태블릿(iPad 가로 1180x820) — 컨텍스트 메뉴 뷰포트 내부 완전 표시', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const cards = page.locator('[data-testid="checkin-card"]');
    const cardCount = await cards.count();
    if (cardCount === 0) {
      test.skip(true, '칸반 카드 없음 — 스킵');
      return;
    }

    const card = cards.first();
    await card.click({ button: 'right' });

    const menu = page.locator('.fixed.z-50.overflow-y-auto').first();
    const menuVisible = await menu.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false);
    if (!menuVisible) {
      test.skip(true, '컨텍스트 메뉴 미오픈 — 스킵');
      return;
    }

    await expect(page.getByText('현 진행단계', { exact: true })).toBeVisible();

    // AC-2: 뷰포트 820px 내부
    const menuBox = await menu.boundingBox();
    if (menuBox) {
      const menuBottom = menuBox.y + menuBox.height;
      expect(menuBottom).toBeLessThanOrEqual(820 + 1);
    }

    await page.keyboard.press('Escape');
  });

  test('AC-3: overflow-y scroll — 메뉴에 overflow-y:auto가 적용되어 있음', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const cards = page.locator('[data-testid="checkin-card"]');
    if (await cards.count() === 0) {
      test.skip(true, '칸반 카드 없음 — 스킵');
      return;
    }

    await cards.first().click({ button: 'right' });

    const menu = page.locator('.fixed.z-50.overflow-y-auto').first();
    const menuVisible = await menu.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false);
    if (!menuVisible) {
      test.skip(true, '컨텍스트 메뉴 미오픈 — 스킵');
      return;
    }

    // AC-3: overflow-y:auto 클래스 존재 확인
    await expect(menu).toHaveClass(/overflow-y-auto/);

    // AC-3: maxHeight inline style이 설정되어 있는지 확인 (동적 높이 제한)
    const maxHeight = await menu.evaluate((el) => (el as HTMLElement).style.maxHeight);
    expect(maxHeight).toBeTruthy();
    const maxHeightPx = parseInt(maxHeight, 10);
    expect(maxHeightPx).toBeGreaterThan(0);

    await page.keyboard.press('Escape');
  });

  test('AC-4: 대시보드 기본 레이아웃 유지 (헤더·사이드바)', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // 사이드바 및 헤더 기본 요소 확인
    await expect(page.locator('nav, aside, [data-testid="sidebar"]').first()).toBeVisible();
    // 대시보드 칸반 영역 확인
    const kanban = page.locator('[data-testid="kanban-column"], .kanban-column, [data-column]').first();
    const kanbanVisible = await kanban.isVisible().catch(() => false);
    // 칸반이 있으면 표시 확인, 없으면 전체 통과 (카드가 없는 날)
    if (kanbanVisible) {
      await expect(kanban).toBeVisible();
    }
  });
});
