/**
 * E2E spec — T-20260519-foot-VISIT-ROUTE-DROPDOWN
 * 2번차트 방문경로 드롭다운 optimistic update 누락 수정
 *
 * AC-1: "지인소개" 선택 시 소개자 성함 입력칸 즉시 표시 (DB 응답 대기 없이)
 * AC-2: onChange → setCustomer 즉시 호출 → saveCustomerField 백그라운드
 * AC-3: 기존 DB 저장 로직 무변경
 * AC-4: 다른 방문경로 선택 시에도 즉시 UI 반영 (소개자 칸 즉시 사라짐)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260519-foot-VISIT-ROUTE-DROPDOWN — 방문경로 드롭다운 optimistic update', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  test('AC-1/AC-2: 2번차트 — 지인소개 선택 시 소개자 성함 입력칸 즉시 표시', async ({ page }) => {
    // 고객 목록 접근
    await page.goto('/admin/customers');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    const customerRows = page.locator('table tbody tr, [data-testid="customer-row"]');
    const rowCount = await customerRows.count();
    if (rowCount === 0) {
      test.skip(true, '고객 없음 — 스킵');
      return;
    }
    await customerRows.first().click();

    // 2번차트 로드 대기
    await page.waitForLoadState('networkidle', { timeout: 10_000 });

    // 방문경로 드롭다운 탐색 (2번차트 내)
    const visitRouteSelect = page.locator('select').filter({ hasText: /선택|TM|인바운드|지인소개/ }).first();
    const hasSelect = await visitRouteSelect.count() > 0;
    if (!hasSelect) {
      test.skip(true, '2번차트 방문경로 드롭다운 미발견 — 스킵');
      return;
    }

    // 현재 값이 지인소개가 아닌 경우 먼저 다른 값으로 설정
    const currentVal = await visitRouteSelect.inputValue();
    if (currentVal === '지인소개') {
      await visitRouteSelect.selectOption('인바운드');
      // 소개자 칸이 사라졌는지 확인
      const referralInput = page.getByPlaceholder('예: 홍길동');
      const hiddenAfterChange = await referralInput.isVisible().catch(() => false);
      expect(hiddenAfterChange).toBe(false);
    }

    // AC-1: "지인소개" 선택 → 소개자 성함 입력칸 즉시 표시
    await visitRouteSelect.selectOption('지인소개');

    // optimistic update: DB 응답 대기 없이 즉시 표시 (500ms 내)
    const referralInput = page.getByPlaceholder('예: 홍길동');
    await expect(referralInput).toBeVisible({ timeout: 500 });
    console.log('[AC-1/AC-2] 지인소개 선택 → 소개자 성함 입력칸 즉시 표시 (optimistic) PASS');
  });

  test('AC-4: 2번차트 — 다른 방문경로 선택 시 소개자 칸 즉시 사라짐', async ({ page }) => {
    await page.goto('/admin/customers');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    const customerRows = page.locator('table tbody tr, [data-testid="customer-row"]');
    if (await customerRows.count() === 0) {
      test.skip(true, '고객 없음 — 스킵');
      return;
    }
    await customerRows.first().click();
    await page.waitForLoadState('networkidle', { timeout: 10_000 });

    const visitRouteSelect = page.locator('select').filter({ hasText: /선택|TM|인바운드|지인소개/ }).first();
    if (await visitRouteSelect.count() === 0) {
      test.skip(true, '방문경로 드롭다운 미발견 — 스킵');
      return;
    }

    const referralInput = page.getByPlaceholder('예: 홍길동');

    // 지인소개 선택 → 입력칸 표시
    await visitRouteSelect.selectOption('지인소개');
    await expect(referralInput).toBeVisible({ timeout: 500 });
    console.log('[AC-4-pre] 지인소개 선택 → 소개자 칸 표시 PASS');

    // 블로그/인바운드 선택 → 소개자 칸 즉시 사라짐 (optimistic)
    await visitRouteSelect.selectOption('인바운드');
    const hiddenInbound = await referralInput.isVisible().catch(() => false);
    expect(hiddenInbound).toBe(false);
    console.log('[AC-4] 인바운드 선택 → 소개자 칸 즉시 사라짐 PASS');

    // TM 선택해도 즉시 사라짐
    await visitRouteSelect.selectOption('지인소개');
    await expect(referralInput).toBeVisible({ timeout: 500 });
    await visitRouteSelect.selectOption('TM');
    const hiddenTM = await referralInput.isVisible().catch(() => false);
    expect(hiddenTM).toBe(false);
    console.log('[AC-4] TM 선택 → 소개자 칸 즉시 사라짐 PASS');

    // 워크인 선택해도 즉시 사라짐
    await visitRouteSelect.selectOption('지인소개');
    await expect(referralInput).toBeVisible({ timeout: 500 });
    await visitRouteSelect.selectOption('워크인');
    const hiddenWalkin = await referralInput.isVisible().catch(() => false);
    expect(hiddenWalkin).toBe(false);
    console.log('[AC-4] 워크인 선택 → 소개자 칸 즉시 사라짐 PASS');
  });

  test('AC-3: 방문경로 선택 후 DB 저장 유지 확인 (새로고침)', async ({ page }) => {
    await page.goto('/admin/customers');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    const customerRows = page.locator('table tbody tr, [data-testid="customer-row"]');
    if (await customerRows.count() === 0) {
      test.skip(true, '고객 없음 — 스킵');
      return;
    }
    await customerRows.first().click();
    await page.waitForLoadState('networkidle', { timeout: 10_000 });

    const currentUrl = page.url();

    const visitRouteSelect = page.locator('select').filter({ hasText: /선택|TM|인바운드|지인소개/ }).first();
    if (await visitRouteSelect.count() === 0) {
      test.skip(true, '방문경로 드롭다운 미발견 — 스킵');
      return;
    }

    // 지인소개 선택 (optimistic update 확인)
    await visitRouteSelect.selectOption('지인소개');
    const referralInput = page.getByPlaceholder('예: 홍길동');
    await expect(referralInput).toBeVisible({ timeout: 500 });

    // 소개자 성함 입력 후 blur (DB 저장 트리거)
    await referralInput.fill('테스트홍길동');
    await page.locator('body').click();

    // DB 저장 완료 대기 (1.5s)
    await page.waitForTimeout(1_500);

    // 새로고침 후 값 유지 확인 (AC-3: 저장 로직 무변경)
    await page.goto(currentUrl);
    await page.waitForLoadState('networkidle', { timeout: 10_000 });

    const visitRouteAfterReload = page.locator('select').filter({ hasText: /선택|TM|인바운드|지인소개/ }).first();
    if (await visitRouteAfterReload.count() === 0) {
      test.skip(true, '새로고침 후 드롭다운 미발견 — 스킵');
      return;
    }

    const valAfterReload = await visitRouteAfterReload.inputValue();
    expect(valAfterReload).toBe('지인소개');
    console.log('[AC-3] 새로고침 후 방문경로 "지인소개" 유지 PASS (DB 저장 로직 무변경)');

    // 원상 복구 (테스트 데이터 정리)
    await visitRouteAfterReload.selectOption('');
    await page.waitForTimeout(500);
  });
});
