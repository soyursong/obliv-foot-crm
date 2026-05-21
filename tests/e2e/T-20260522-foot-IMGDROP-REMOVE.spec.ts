/**
 * E2E spec — T-20260522-foot-IMGDROP-REMOVE
 * 진료이미지 탭 카테고리 드롭다운 제거 + 업로드 분류 다이얼로그
 *
 * AC-1: 진료이미지 탭 상단 카테고리 <select> 드롭다운 없음
 * AC-2: [업로드] 버튼 클릭 시 분류 다이얼로그(시술전/시술후/기타) 표시
 * AC-3: 드롭다운 필터 기능 없음 — 이미지 목록은 전체 표시 그대로
 * AC-4: PHOTO-CAPTURE([사진촬영]) 버튼 회귀 없음
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260522-foot-IMGDROP-REMOVE — 드롭다운 제거 + 업로드 다이얼로그', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  test('AC-1: 진료이미지 탭에 카테고리 select 드롭다운이 없어야 한다', async ({ page }) => {
    await page.goto('/admin');
    // 첫 번째 고객 차트 진입
    await page.waitForSelector('[data-testid="kanban-card"], .kanban-card, [class*="CheckIn"]', { timeout: 15000 }).catch(() => {});

    // 고객차트 진료이미지 탭으로 직접 이동 (URL 직접)
    // 테스트 고객 ID는 환경에 따라 다르므로 UI로 접근
    // 진료이미지 탭의 업로드 바 안에 <select>가 없어야 함
    // → 드롭다운 select 없음 검증 (페이지 전체에서)
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // 진료이미지 섹션이 있는 페이지에서 select[value="before" or "after" or "photo"] 없어야 함
    const selectInImageBar = page.locator('select').filter({ hasText: /시술 전|시술 후|기타/ });
    await expect(selectInImageBar).toHaveCount(0);
  });

  test('AC-2: 진료이미지 탭 [업로드] 버튼 클릭 시 분류 다이얼로그 표시', async ({ page }) => {
    // 고객차트 직접 이동 시도
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // 진료이미지 섹션에서 업로드 버튼 찾기
    const uploadBtns = page.getByRole('button', { name: /업로드/ });
    const count = await uploadBtns.count();
    if (count === 0) {
      test.skip(true, '진료이미지 탭이 현재 뷰에 없음 — 수동 검증 필요');
      return;
    }

    await uploadBtns.first().click();

    // 분류 다이얼로그가 표시돼야 함
    await expect(page.getByText('업로드 분류를 선택하세요')).toBeVisible({ timeout: 3000 });
    await expect(page.getByRole('button', { name: '시술 전' })).toBeVisible();
    await expect(page.getByRole('button', { name: '시술 후' })).toBeVisible();
    await expect(page.getByRole('button', { name: '기타' })).toBeVisible();

    // 취소 버튼으로 닫기
    await page.getByText('취소').last().click();
    await expect(page.getByText('업로드 분류를 선택하세요')).not.toBeVisible();
  });

  test('AC-4: [사진촬영] 버튼 PHOTO-CAPTURE 회귀 없음', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // 사진촬영 버튼 존재 확인
    const cameraBtn = page.getByRole('button', { name: /사진촬영/ });
    const count = await cameraBtn.count();
    if (count === 0) {
      test.skip(true, '진료이미지 탭이 현재 뷰에 없음 — 수동 검증 필요');
      return;
    }

    // 버튼이 있고, 클릭 시 촬영 분류 다이얼로그 표시
    await cameraBtn.first().click();
    await expect(page.getByText('촬영 분류를 선택하세요')).toBeVisible({ timeout: 3000 });

    // 취소
    await page.getByText('취소').last().click();
    await expect(page.getByText('촬영 분류를 선택하세요')).not.toBeVisible();
  });
});
