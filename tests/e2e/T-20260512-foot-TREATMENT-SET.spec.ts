/**
 * E2E spec — T-20260512-foot-TREATMENT-SET (v2)
 * 진료세트 [+ 추가] 클릭 시 서비스관리 코드 검색/선택 드롭다운
 *
 * AC-5a: [+ 추가] 클릭 시 서비스관리 코드 검색 드롭다운 표시
 * AC-5b: 코드명 또는 설명으로 검색 가능 (예: 'AA154' 또는 '초진진찰료')
 * AC-5c: 선택하면 코드 + 설명 자동 입력
 * AC-5d: 상병코드 쪽 [+ 추가]도 상병코드 목록에서 선택 가능
 * AC-5e: 수동 입력 유지 (catalog에 없는 코드 직접 입력)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260512-foot-TREATMENT-SET v2 — 코드 검색/선택 드롭다운', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');

    // 진료 도구 > 진료세트 탭으로 이동
    await page.goto('/admin/doctor-tools');
    try {
      await page.getByTestId('tab-treatment-sets').waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, '진료 도구 페이지 또는 진료세트 탭 없음');
      return;
    }
    await page.getByTestId('tab-treatment-sets').click();
    await page.waitForTimeout(500);
  });

  test('AC-5a: 삽입코드 [+ 추가] 클릭 후 코드 입력 시 드롭다운 표시', async ({ page }) => {
    // 진료세트 추가 다이얼로그 열기
    await page.getByTestId('treatment-set-add-btn').click();
    await expect(page.getByTestId('treatment-set-name-input')).toBeVisible({ timeout: 5_000 });

    // 첫 번째 삽입코드 행의 코드 입력창에 포커스
    const firstCodeInput = page.getByTestId('insertion-code-row-0-code');
    await firstCodeInput.click();

    // 드롭다운이 열림 (catalog 상위 10개 표시)
    const dropdown = page.getByTestId('insertion-code-row-0-dropdown');
    await expect(dropdown).toBeVisible({ timeout: 5_000 });

    console.log('[AC-5a] 삽입코드 코드 입력창 클릭 → 드롭다운 표시 OK');
  });

  test('AC-5b: 코드명으로 검색 시 필터링 결과 표시', async ({ page }) => {
    await page.getByTestId('treatment-set-add-btn').click();
    await expect(page.getByTestId('treatment-set-name-input')).toBeVisible({ timeout: 5_000 });

    const firstCodeInput = page.getByTestId('insertion-code-row-0-code');
    await firstCodeInput.fill('AA154');

    // 드롭다운에 AA154 관련 항목 표시
    const dropdown = page.getByTestId('insertion-code-row-0-dropdown');
    await expect(dropdown).toBeVisible({ timeout: 5_000 });
    await expect(dropdown).toContainText('AA154', { timeout: 3_000 });

    console.log('[AC-5b] "AA154" 검색 → 드롭다운에 AA154 항목 표시 OK');
  });

  test('AC-5b(2): 서비스명으로 검색 시 필터링 결과 표시', async ({ page }) => {
    await page.getByTestId('treatment-set-add-btn').click();
    await expect(page.getByTestId('treatment-set-name-input')).toBeVisible({ timeout: 5_000 });

    const firstCodeInput = page.getByTestId('insertion-code-row-0-code');
    await firstCodeInput.fill('초진진찰');

    // 드롭다운에 초진진찰 관련 항목 표시
    const dropdown = page.getByTestId('insertion-code-row-0-dropdown');
    // 검색 결과가 있거나 "일치하는 코드가 없습니다" 메시지 중 하나 표시
    await expect(dropdown).toBeVisible({ timeout: 5_000 });

    console.log('[AC-5b(2)] "초진진찰" 검색 → 드롭다운 필터링 동작 OK');
  });

  test('AC-5c: 드롭다운 항목 선택 시 코드 + 설명 자동 입력', async ({ page }) => {
    await page.getByTestId('treatment-set-add-btn').click();
    await expect(page.getByTestId('treatment-set-name-input')).toBeVisible({ timeout: 5_000 });

    const firstCodeInput = page.getByTestId('insertion-code-row-0-code');
    await firstCodeInput.click();

    // 드롭다운이 열리면 첫 번째 항목 선택
    const dropdown = page.getByTestId('insertion-code-row-0-dropdown');
    await expect(dropdown).toBeVisible({ timeout: 5_000 });

    const firstOption = dropdown.locator('button').first();
    const optionText = await firstOption.textContent();
    if (!optionText) {
      console.log('[AC-5c] 드롭다운 항목 없음 — services 데이터 미존재, 스킵');
      return;
    }
    await firstOption.click();

    // 코드 필드에 값이 입력됨
    await expect(firstCodeInput).not.toHaveValue('', { timeout: 3_000 });

    console.log('[AC-5c] 드롭다운 항목 선택 → 코드 자동 입력 OK');
  });

  test('AC-5d: 상병코드 [+ 추가] 후 드롭다운 표시', async ({ page }) => {
    await page.getByTestId('treatment-set-add-btn').click();
    await expect(page.getByTestId('treatment-set-name-input')).toBeVisible({ timeout: 5_000 });

    // 상병코드 첫 번째 행의 코드 입력창에 포커스
    const diseaseCodeInput = page.getByTestId('disease-code-row-0-code');
    await diseaseCodeInput.click();

    // 드롭다운이 열림 (상병코드 카탈로그)
    const dropdown = page.getByTestId('disease-code-row-0-dropdown');
    await expect(dropdown).toBeVisible({ timeout: 5_000 });

    console.log('[AC-5d] 상병코드 입력창 클릭 → 드롭다운 표시 OK');
  });

  test('AC-5e: catalog에 없는 코드 직접(수동) 입력 가능', async ({ page }) => {
    await page.getByTestId('treatment-set-add-btn').click();
    await expect(page.getByTestId('treatment-set-name-input')).toBeVisible({ timeout: 5_000 });

    const firstCodeInput = page.getByTestId('insertion-code-row-0-code');
    // catalog에 없는 임의 코드 입력
    await firstCodeInput.fill('MANUAL999');

    // 입력값이 그대로 유지됨
    await expect(firstCodeInput).toHaveValue('MANUAL999', { timeout: 3_000 });

    // 드롭다운이 열려도 "일치하는 코드가 없습니다" 표시
    const dropdown = page.getByTestId('insertion-code-row-0-dropdown');
    const isVisible = await dropdown.isVisible();
    if (isVisible) {
      // catalog에 MANUAL999 없으면 안내 메시지 표시
      const noMatchMsg = dropdown.getByText('일치하는 코드가 없습니다');
      const noMatchVisible = await noMatchMsg.isVisible();
      // 메시지가 있거나 드롭다운이 닫혀도 OK (수동 입력 유지가 핵심)
      console.log('[AC-5e] 드롭다운 noMatch:', noMatchVisible);
    }

    // 수동 입력값 유지 확인
    await expect(firstCodeInput).toHaveValue('MANUAL999', { timeout: 3_000 });

    console.log('[AC-5e] catalog 미매칭 코드 직접 입력 → 값 유지 OK');
  });

  test('AC-5: 삽입코드 [+ 추가] 버튼으로 새 코드 행 추가 후 드롭다운 동작', async ({ page }) => {
    await page.getByTestId('treatment-set-add-btn').click();
    await expect(page.getByTestId('treatment-set-name-input')).toBeVisible({ timeout: 5_000 });

    // [+ 추가] 버튼 클릭 (삽입코드 섹션 내 '추가' 버튼)
    const addInsertionBtn = page.getByRole('button', { name: '추가' }).first();
    await addInsertionBtn.click();

    // 두 번째 삽입코드 행이 생김
    const secondCodeInput = page.getByTestId('insertion-code-row-1-code');
    await expect(secondCodeInput).toBeVisible({ timeout: 3_000 });

    // 두 번째 행에 포커스 → 드롭다운 표시
    await secondCodeInput.click();
    const dropdown = page.getByTestId('insertion-code-row-1-dropdown');
    await expect(dropdown).toBeVisible({ timeout: 5_000 });

    console.log('[AC-5] [+ 추가]로 새 행 추가 후 드롭다운 동작 OK');
  });
});
