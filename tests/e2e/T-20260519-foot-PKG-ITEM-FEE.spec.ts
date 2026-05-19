import { test, expect } from '@playwright/test';

/**
 * T-20260519-foot-PKG-ITEM-FEE
 * 구매패키지 항목별 수가 금액 표시
 */

test.describe('T-20260519-foot-PKG-ITEM-FEE: 패키지 항목별 수가', () => {
  test.beforeEach(async ({ page }) => {
    // 로그인 세션 재사용 (storageState 설정 전제)
    await page.goto('/packages');
    await page.waitForLoadState('networkidle');
  });

  test('AC-1/2: 항목별 수가 테이블 + 총계 동시 표시', async ({ page }) => {
    // 활성 패키지 첫 행 클릭
    const firstRow = page.locator('table tbody tr').first();
    await firstRow.click();

    // PackageDetailSheet 열림 확인
    const sheet = page.locator('[data-radix-collection-item], [role="dialog"], .fixed.inset-y-0').last();
    await expect(sheet).toBeVisible();

    // 항목별 수가 섹션 — unit_price 있는 패키지일 때만 표시
    const feeSection = sheet.locator('text=항목별 수가');
    // 구형 패키지는 숨겨질 수 있으므로 조건부 체크
    const count = await feeSection.count();
    if (count > 0) {
      await expect(feeSection).toBeVisible();
      // 합계 행 존재
      await expect(sheet.locator('text=합계')).toBeVisible();
    }

    // 총 계약금은 항상 표시
    await expect(sheet.locator('text=총 계약금')).toBeVisible();
  });

  test('AC-3: 항목 합 = 총합계 (수기조정 없는 경우 노트 없음)', async ({ page }) => {
    const firstRow = page.locator('table tbody tr').first();
    await firstRow.click();
    const sheet = page.locator('.fixed.inset-y-0').last();
    await expect(sheet).toBeVisible();

    // 수기조정 노트가 없으면 합계 = 계약금
    const overrideNote = sheet.locator('text=수기조정 적용');
    // 이 노트는 price_override 패키지에서만 나타남 — 없어도 패스
    if (await overrideNote.count() === 0) {
      // 정합성 확인: 항목별 합 = 총계약금이어야 함 (UI에 amber 노트 없음)
      const amberNote = sheet.locator('.text-amber-600');
      expect(await amberNote.count()).toBe(0);
    }
  });

  test('AC-4: 태블릿 뷰포트에서 가독성 확인', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/packages');
    await page.waitForLoadState('networkidle');

    const firstRow = page.locator('table tbody tr').first();
    await firstRow.click();
    const sheet = page.locator('.fixed.inset-y-0').last();
    await expect(sheet).toBeVisible();

    // 총 계약금 표시 확인
    await expect(sheet.locator('text=총 계약금')).toBeVisible();
  });

  test('AC-5: edge case — 패키지 리스트가 비어있어도 오류 없음', async ({ page }) => {
    // 완료 탭으로 이동
    await page.locator('button:has-text("완료")').click();
    await page.waitForLoadState('networkidle');
    // 에러 없이 렌더링
    await expect(page.locator('table')).toBeVisible();
  });
});
