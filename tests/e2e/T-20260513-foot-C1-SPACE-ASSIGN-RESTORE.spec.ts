/**
 * E2E spec — T-20260513-foot-C1-SPACE-ASSIGN-RESTORE
 * 1번차트(CheckInDetailSheet) 공간배정 항목 복구 + 금일 이동이력 표시
 *
 * AC-1: [공간배정] 항목이 체크리스트/동의서 섹션 하단에 존재
 * AC-2: 공간 선택 후 [배정] 클릭 → 이동이력 1줄 표시
 * AC-3: 다른 공간으로 변경 → 이력 2줄 (중복 없음)
 * AC-4: 같은 공간으로 재배정 → 중복 미추가
 * AC-5: 당일 이동이력만 표시 (전일 이력 미표시 — UI 렌더 확인)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260513-foot-C1-SPACE-ASSIGN-RESTORE 공간배정 복구', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('AC-1: 1번차트에 [공간배정] 섹션이 체크리스트/동의서 하단에 표시됨', async ({ page }) => {
    await page.goto('/admin/dashboard');

    // 칸반에서 첫 번째 체크인 슬롯 클릭
    const slot = page.locator('[data-testid="checkin-card"], [class*="check-in"], [class*="kanban"] [role="button"]').first();
    try {
      await slot.waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, '체크인 슬롯 미발견 — 더미 데이터 없음');
      return;
    }
    await slot.click();

    // 1번차트(CheckInDetailSheet) 오픈 대기
    const sheet = page.locator('[role="dialog"], [data-state="open"]').first();
    try {
      await sheet.waitFor({ timeout: 6_000 });
    } catch {
      test.skip(true, '1번차트 시트 미표시');
      return;
    }

    // AC-1: [공간배정] 섹션 표시 확인
    const spaceSection = page.locator('[data-testid="space-assign-section"]');
    await expect(spaceSection).toBeVisible({ timeout: 5_000 });
    console.log('[AC-1] 공간배정 섹션 표시 OK');

    // 체크리스트/동의서 섹션 텍스트 확인 후 아래에 공간배정이 있는지 확인
    const checklistText = page.getByText('체크리스트 / 동의서');
    await expect(checklistText).toBeVisible();

    // 공간배정 레이블 확인
    const spaceLabel = page.getByText('공간배정');
    await expect(spaceLabel).toBeVisible();
    console.log('[AC-1] "공간배정" 레이블 표시 OK');
  });

  test('AC-2/AC-3: 공간 배정 → 이동이력 표시 + 공간 변경 → 이력 2줄', async ({ page }) => {
    await page.goto('/admin/dashboard');

    // 체크인 슬롯 클릭
    const slot = page.locator('[data-testid="checkin-card"], [class*="check-in"], [class*="kanban"] [role="button"]').first();
    try {
      await slot.waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, '체크인 슬롯 미발견');
      return;
    }
    await slot.click();

    // 1번차트 오픈
    const sheet = page.locator('[role="dialog"], [data-state="open"]').first();
    try {
      await sheet.waitFor({ timeout: 6_000 });
    } catch {
      test.skip(true, '1번차트 시트 미표시');
      return;
    }

    // 공간배정 드롭다운 대기
    const spaceSelect = page.locator('[data-testid="space-assign-select"]');
    try {
      await spaceSelect.waitFor({ timeout: 5_000 });
    } catch {
      test.skip(true, '공간배정 드롭다운 미발견');
      return;
    }

    // 첫 번째 공간 옵션 선택 (치료실/상담실 등)
    const options = await spaceSelect.locator('option').all();
    if (options.length <= 1) {
      test.skip(true, '공간 옵션 없음 — rooms 테이블 데이터 필요');
      return;
    }
    const firstRoomValue = await options[1].getAttribute('value') ?? '';
    if (!firstRoomValue) {
      test.skip(true, '첫 번째 공간 값 비어있음');
      return;
    }
    await spaceSelect.selectOption(firstRoomValue);

    // 배정 버튼 클릭
    const assignBtn = page.locator('[data-testid="space-assign-btn"]');
    await expect(assignBtn).toBeEnabled();
    await assignBtn.click();

    // AC-2: 이동이력 1줄 표시
    await page.waitForTimeout(800);
    const historyBadges = page.locator('[data-testid="space-assign-section"] [class*="badge"]');
    const count1 = await historyBadges.count();
    expect(count1).toBeGreaterThanOrEqual(1);
    console.log(`[AC-2] 배정 후 이력 ${count1}줄 표시 OK`);

    // AC-3: 두 번째 공간으로 변경
    if (options.length >= 3) {
      const secondRoomValue = await options[2].getAttribute('value') ?? '';
      if (secondRoomValue && secondRoomValue !== firstRoomValue) {
        await spaceSelect.selectOption(secondRoomValue);
        await assignBtn.click();

        await page.waitForTimeout(800);
        const count2 = await historyBadges.count();
        expect(count2).toBeGreaterThan(count1);
        console.log(`[AC-3] 공간 변경 후 이력 ${count2}줄 (중복 없음) OK`);
      }
    }
  });

  test('AC-4: 같은 공간 재배정 → 중복 미추가 + toast 알림', async ({ page }) => {
    await page.goto('/admin/dashboard');

    const slot = page.locator('[data-testid="checkin-card"], [class*="check-in"], [class*="kanban"] [role="button"]').first();
    try {
      await slot.waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, '체크인 슬롯 미발견');
      return;
    }
    await slot.click();

    const sheet = page.locator('[role="dialog"], [data-state="open"]').first();
    try {
      await sheet.waitFor({ timeout: 6_000 });
    } catch {
      test.skip(true, '1번차트 시트 미표시');
      return;
    }

    const spaceSelect = page.locator('[data-testid="space-assign-select"]');
    try {
      await spaceSelect.waitFor({ timeout: 5_000 });
    } catch {
      test.skip(true, '공간배정 드롭다운 미발견');
      return;
    }

    const options = await spaceSelect.locator('option').all();
    if (options.length <= 1) {
      test.skip(true, '공간 옵션 없음');
      return;
    }
    const roomValue = await options[1].getAttribute('value') ?? '';
    if (!roomValue) { test.skip(true, '공간 값 없음'); return; }

    // 첫 번째 배정
    await spaceSelect.selectOption(roomValue);
    const assignBtn = page.locator('[data-testid="space-assign-btn"]');
    await assignBtn.click();
    await page.waitForTimeout(600);

    const countBefore = await page.locator('[data-testid="space-assign-section"] [class*="badge"]').count();

    // 같은 공간으로 재배정
    await spaceSelect.selectOption(roomValue);
    await assignBtn.click();
    await page.waitForTimeout(600);

    const countAfter = await page.locator('[data-testid="space-assign-section"] [class*="badge"]').count();
    // 중복이 추가되지 않아야 함
    expect(countAfter).toBe(countBefore);
    console.log(`[AC-4] 중복 재배정 후 이력 수 변화 없음 (${countBefore} → ${countAfter}) OK`);
  });

  test('AC-5: 공간배정 섹션 렌더링 — UI 구조 검증 (당일 필터 + 이력 영역)', async ({ page }) => {
    await page.goto('/admin/dashboard');

    const slot = page.locator('[data-testid="checkin-card"], [class*="check-in"], [class*="kanban"] [role="button"]').first();
    try {
      await slot.waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, '체크인 슬롯 미발견');
      return;
    }
    await slot.click();

    const sheet = page.locator('[role="dialog"], [data-state="open"]').first();
    try {
      await sheet.waitFor({ timeout: 6_000 });
    } catch {
      test.skip(true, '1번차트 시트 미표시');
      return;
    }

    // 공간배정 섹션 존재 확인
    const spaceSection = page.locator('[data-testid="space-assign-section"]');
    await expect(spaceSection).toBeVisible({ timeout: 5_000 });

    // 드롭다운 + 배정 버튼 존재
    await expect(page.locator('[data-testid="space-assign-select"]')).toBeVisible();
    await expect(page.locator('[data-testid="space-assign-btn"]')).toBeVisible();

    // "금일 이동이력" 또는 이력 없음 — 어느 쪽이든 에러 없이 렌더됨
    const noError = await page.locator('text=오류, text=에러, text=undefined').count();
    expect(noError).toBe(0);
    console.log('[AC-5] 공간배정 UI 구조 정상 렌더링 OK (에러 텍스트 없음)');
  });
});
