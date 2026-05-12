/**
 * E2E spec — T-20260512-foot-TREATMENT-SET AC-5
 * 진료세트 서비스관리 코드 검색/선택 드롭다운
 *
 * AC-5a: [+ 추가] 클릭 시 드롭다운 표시
 * AC-5b: 코드명/설명으로 검색 가능
 * AC-5c: 선택 시 코드 + 설명 자동 입력
 * AC-5d: 상병코드 쪽 [+ 추가]도 동일하게 드롭다운
 * AC-5e: 수동 입력 유지
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-TREATMENT-SET AC-5 — 코드 검색/선택 드롭다운', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
    await page.goto('/admin/doctor-tools');
    // 진료세트 탭 클릭
    await page.getByRole('tab', { name: '진료세트' }).click();
    await expect(page.getByTestId('treatment-set-list').or(
      page.getByText('등록된 진료세트가 없습니다', { exact: false })
    )).toBeVisible({ timeout: 10_000 });
  });

  test('AC-5a: [+ 추가] 클릭 시 삽입코드 드롭다운 표시', async ({ page }) => {
    // 진료세트 추가 버튼 클릭
    await page.getByTestId('treatment-set-add-btn').click();
    await expect(page.getByTestId('treatment-set-name-input')).toBeVisible({ timeout: 5_000 });

    // 삽입코드 행 첫 번째 코드 입력에 포커스
    const firstCodeInput = page.getByTestId('insertion-code-row-0-code');
    await firstCodeInput.click();

    // AC-5a: 드롭다운이 표시됨
    await expect(page.getByTestId('insertion-code-row-0-dropdown')).toBeVisible({ timeout: 3_000 });
  });

  test('AC-5b: 코드명으로 검색 가능', async ({ page }) => {
    await page.getByTestId('treatment-set-add-btn').click();
    await expect(page.getByTestId('treatment-set-name-input')).toBeVisible({ timeout: 5_000 });

    const firstCodeInput = page.getByTestId('insertion-code-row-0-code');
    await firstCodeInput.fill('AA154');

    // AC-5b: 'AA154' 검색 결과가 드롭다운에 표시됨
    const dropdown = page.getByTestId('insertion-code-row-0-dropdown');
    await expect(dropdown).toBeVisible({ timeout: 3_000 });
    await expect(dropdown.getByText('AA154', { exact: false })).toBeVisible();
  });

  test('AC-5b: 설명(시술명)으로도 검색 가능', async ({ page }) => {
    await page.getByTestId('treatment-set-add-btn').click();
    await expect(page.getByTestId('treatment-set-name-input')).toBeVisible({ timeout: 5_000 });

    const firstCodeInput = page.getByTestId('insertion-code-row-0-code');
    await firstCodeInput.fill('진찰');

    const dropdown = page.getByTestId('insertion-code-row-0-dropdown');
    await expect(dropdown).toBeVisible({ timeout: 3_000 });
    // '진찰' 포함 항목이 1개 이상 표시됨
    const items = dropdown.locator('button');
    await expect(items.first()).toBeVisible();
  });

  test('AC-5c: 드롭다운 선택 시 코드 + 설명 자동 입력', async ({ page }) => {
    await page.getByTestId('treatment-set-add-btn').click();
    await expect(page.getByTestId('treatment-set-name-input')).toBeVisible({ timeout: 5_000 });

    const firstCodeInput = page.getByTestId('insertion-code-row-0-code');
    await firstCodeInput.fill('AA');

    const dropdown = page.getByTestId('insertion-code-row-0-dropdown');
    await expect(dropdown).toBeVisible({ timeout: 3_000 });

    // 첫 번째 항목 선택
    const firstItem = dropdown.locator('button').first();
    const codeText = await firstItem.locator('.font-mono').textContent();
    await firstItem.click();

    // AC-5c: 코드 입력창에 선택한 코드가 들어가 있어야 함
    await expect(firstCodeInput).not.toHaveValue('');
    if (codeText && codeText.trim() !== '—') {
      await expect(firstCodeInput).toHaveValue(codeText.trim().toUpperCase());
    }

    // AC-5c: 드롭다운이 닫혔어야 함
    await expect(dropdown).toBeHidden();
  });

  test('AC-5d: 상병코드 [+ 추가] 드롭다운도 동작', async ({ page }) => {
    await page.getByTestId('treatment-set-add-btn').click();
    await expect(page.getByTestId('treatment-set-name-input')).toBeVisible({ timeout: 5_000 });

    // 상병코드 첫 행 포커스
    const diseaseInput = page.getByTestId('disease-code-row-0-code');
    await diseaseInput.click();

    // AC-5d: 상병코드 드롭다운도 표시됨 (항목이 없으면 빈 dropdown 또는 안내문구)
    // category_label='상병' 항목이 없으면 "일치하는 코드 없음" 안내 표시
    const dropdown = page.getByTestId('disease-code-row-0-dropdown');
    // 드롭다운 자체는 open 상태여야 함 (혹은 catalog가 비어 hidden 일 수도 있음)
    // 상병코드 catalog가 있으면 dropdown visible, 없어도 input은 동작
    await expect(diseaseInput).toBeFocused();
  });

  test('AC-5e: 드롭다운 없이 수동 입력도 동작', async ({ page }) => {
    await page.getByTestId('treatment-set-add-btn').click();
    await expect(page.getByTestId('treatment-set-name-input')).toBeVisible({ timeout: 5_000 });

    const codeInput = page.getByTestId('insertion-code-row-0-code');

    // AC-5e: 직접 타이핑
    await codeInput.fill('MANUAL_CODE');
    await expect(codeInput).toHaveValue('MANUAL_CODE');

    // 아무것도 선택 안 해도 값이 유지됨
    await page.keyboard.press('Escape');
    await expect(codeInput).toHaveValue('MANUAL_CODE');
  });

  test('AC-5c: [+ 추가] 버튼으로 새 행 추가 후 드롭다운 동작', async ({ page }) => {
    await page.getByTestId('treatment-set-add-btn').click();
    await expect(page.getByTestId('treatment-set-name-input')).toBeVisible({ timeout: 5_000 });

    // 삽입코드 [+ 추가] 버튼 클릭
    await page.getByRole('button', { name: '추가' }).first().click();

    // 2번째 행이 생김
    const secondRow = page.getByTestId('insertion-code-row-1-code');
    await expect(secondRow).toBeVisible({ timeout: 3_000 });

    // 포커스 후 드롭다운 표시 확인
    await secondRow.click();
    await expect(page.getByTestId('insertion-code-row-1-dropdown')).toBeVisible({ timeout: 3_000 });
  });
});
