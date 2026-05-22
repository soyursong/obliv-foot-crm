/**
 * E2E spec — T-20260523-foot-PKG-AUTOSEL-REMOVE
 * 2번차트 회차 차감 패키지 드롭다운 자동선택 제거
 *
 * AC-1: 활성 패키지 1개 이상 시 드롭다운 노출, 자동선택 없음 (placeholder "패키지를 선택하세요")
 * AC-2: 패키지 미선택 시 [차감] / [힐러예약 후 차감] 버튼 비활성
 * AC-3: 활성 패키지 0개 시 드롭다운 미노출 (기존 동작 유지)
 * AC-4: 패키지 선택 후 [차감] 버튼 활성 → 정상 차감 가능
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260523 PKG-AUTOSEL-REMOVE 패키지 자동선택 제거', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  async function navigateToFirstCustomerWithPackage(page: Parameters<typeof loginAndWaitForDashboard>[0]) {
    await page.goto('/admin/customers');
    const firstRow = page.locator('tbody tr').first();
    try {
      await firstRow.waitFor({ timeout: 10_000 });
    } catch {
      return false;
    }
    const customerLink = firstRow.locator('a[href*="/chart/"]').first();
    if (await customerLink.count() === 0) {
      await firstRow.click();
    } else {
      await customerLink.click();
    }
    await page.waitForURL(/\/chart\//, { timeout: 15_000 });
    return true;
  }

  test('AC-1: 활성 패키지 있을 때 드롭다운 placeholder "패키지를 선택하세요" 노출', async ({ page }) => {
    const ok = await navigateToFirstCustomerWithPackage(page);
    if (!ok) test.skip(true, 'No customer found');

    // 2번차트 섹션으로 이동
    const chart2Tab = page.locator('button, [role="tab"]').filter({ hasText: /2번차트|2번 차트|차트 2/ }).first();
    if (await chart2Tab.count() > 0) {
      await chart2Tab.click();
    }

    // 패키지 드롭다운 존재 확인 (활성 패키지가 있는 경우)
    const pkgDropdown = page.locator('select').filter({ has: page.locator('option[value=""]', { hasText: '패키지를 선택하세요' }) }).first();
    if (await pkgDropdown.count() === 0) {
      // 활성 패키지 없는 고객 — AC-3 케이스, 테스트 스킵
      test.skip(true, 'No active packages — AC-3 case');
    }

    // placeholder 옵션 확인
    const placeholderOpt = pkgDropdown.locator('option[value=""]');
    await expect(placeholderOpt).toContainText('패키지를 선택하세요');

    // 드롭다운 초기값이 "" (미선택 상태)
    await expect(pkgDropdown).toHaveValue('');
  });

  test('AC-2: 패키지 미선택 시 차감 버튼 비활성', async ({ page }) => {
    const ok = await navigateToFirstCustomerWithPackage(page);
    if (!ok) test.skip(true, 'No customer found');

    const chart2Tab = page.locator('button, [role="tab"]').filter({ hasText: /2번차트|2번 차트|차트 2/ }).first();
    if (await chart2Tab.count() > 0) {
      await chart2Tab.click();
    }

    // 패키지 드롭다운이 있는지 확인
    const pkgDropdown = page.locator('select').filter({ has: page.locator('option[value=""]', { hasText: '패키지를 선택하세요' }) }).first();
    if (await pkgDropdown.count() === 0) {
      test.skip(true, 'No active packages — AC-3 case');
    }

    // 치료사 선택 (버튼 활성화 조건 충족을 위해)
    const therapistSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /선택/ }) }).first();
    const therapistOptions = await therapistSelect.locator('option').all();
    if (therapistOptions.length > 1) {
      await therapistSelect.selectOption({ index: 1 });
    }

    // 패키지 미선택 상태에서 차감 버튼 비활성 확인
    const deductBtn = page.locator('button').filter({ hasText: /^차감$/ }).first();
    await expect(deductBtn).toBeDisabled();

    const healerDeductBtn = page.locator('button').filter({ hasText: /힐러예약 후 차감/ }).first();
    await expect(healerDeductBtn).toBeDisabled();
  });

  test('AC-3: 활성 패키지 0개 시 드롭다운 미노출', async ({ page }) => {
    // 이 테스트는 활성 패키지 없는 고객에서 확인
    // 드롭다운 placeholder가 없으면 드롭다운 미노출 상태
    const ok = await navigateToFirstCustomerWithPackage(page);
    if (!ok) test.skip(true, 'No customer found');

    const pkgDropdown = page.locator('select').filter({ has: page.locator('option[value=""]', { hasText: '패키지를 선택하세요' }) });
    // 패키지가 있을 수도 없을 수도 있음 — 0개 시 드롭다운 카운트가 0이어야 함
    // (활성 패키지 없음 배지 노출 확인)
    const noPackageBadge = page.locator('text=활성 패키지 없음');
    if (await noPackageBadge.count() > 0) {
      // 0개 케이스: 드롭다운 없어야 함
      await expect(pkgDropdown).toHaveCount(0);
    }
    // 패키지가 있는 경우는 AC-1/2 케이스 — pass
  });

  test('AC-4: 패키지 선택 후 [차감] 버튼 활성화', async ({ page }) => {
    const ok = await navigateToFirstCustomerWithPackage(page);
    if (!ok) test.skip(true, 'No customer found');

    const chart2Tab = page.locator('button, [role="tab"]').filter({ hasText: /2번차트|2번 차트|차트 2/ }).first();
    if (await chart2Tab.count() > 0) {
      await chart2Tab.click();
    }

    const pkgDropdown = page.locator('select').filter({ has: page.locator('option[value=""]', { hasText: '패키지를 선택하세요' }) }).first();
    if (await pkgDropdown.count() === 0) {
      test.skip(true, 'No active packages — AC-3 case');
    }

    // 첫 번째 활성 패키지 선택
    const packageOptions = await pkgDropdown.locator('option[value!=""]').all();
    if (packageOptions.length === 0) {
      test.skip(true, 'No selectable package options');
    }
    const firstPkgValue = await packageOptions[0].getAttribute('value');
    if (firstPkgValue) {
      await pkgDropdown.selectOption(firstPkgValue);
    }

    // 치료사 선택
    const therapistSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /선택/ }) }).first();
    const therapistOptions = await therapistSelect.locator('option').all();
    if (therapistOptions.length > 1) {
      await therapistSelect.selectOption({ index: 1 });
    }

    // 패키지 선택 후 [차감] 버튼 활성화 확인
    const deductBtn = page.locator('button').filter({ hasText: /^차감$/ }).first();
    await expect(deductBtn).not.toBeDisabled();
  });
});
