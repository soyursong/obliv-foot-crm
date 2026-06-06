/**
 * E2E render smoke — T-20260603-foot-RX-CHART-FOLLOWUP3 C-3 (실DOM)
 * 서류템플릿 등록 다이얼로그가 '서류이름 > 하위분류' 단일 위계로 렌더되는지 실 브라우저 확인.
 *   - 중복 '카테고리(1단계)' 입력(doc-template-category-input)이 제거됐는지(회귀가드)
 *   - 하위분류 드롭다운/입력(doc-template-subcategory-*)이 존재하는지
 * 단계별 브라우저 테스트 의무화 정책 준수.
 */
import { test, expect } from '@playwright/test';

test.describe('C-3 서류템플릿 단일 위계 렌더', () => {
  test('등록 다이얼로그 = 서류이름 + 하위분류(드롭다운), 중복 카테고리 입력 제거', async ({ page }) => {
    await page.goto('/admin/clinic-management');
    // 서류 템플릿 탭으로 이동
    const docTab = page.getByTestId('tab-documents');
    await docTab.waitFor({ timeout: 10_000 });
    await docTab.click();

    const addBtn = page.getByTestId('doc-template-add-btn');
    await expect(addBtn).toBeVisible({ timeout: 5_000 });
    await addBtn.click();

    // 서류이름(카테고리1) 입력은 존재
    await expect(page.getByTestId('doc-template-name-input')).toBeVisible();

    // 중복 '카테고리(1단계)' 입력은 더 이상 없어야 함 (FOLLOWUP2 #2 잘못 구현 정정)
    await expect(page.getByTestId('doc-template-category-input')).toHaveCount(0);

    // 하위분류는 드롭다운(select) 또는 자유입력(input) 중 하나로 노출
    const subSelect = page.getByTestId('doc-template-subcategory-select');
    const subInput = page.getByTestId('doc-template-subcategory-input');
    const total = (await subSelect.count()) + (await subInput.count());
    expect(total).toBeGreaterThanOrEqual(1);
  });
});
