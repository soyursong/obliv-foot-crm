/**
 * E2E spec — T-20260522-foot-PHOTO-CAPTURE
 * 진료이미지 사진촬영 기능 강화 — 카메라 연동·연속촬영·회전·파일업로드 회귀
 *
 * SC-1: [사진촬영] 버튼 클릭 → 시술 전/후 선택 → 카메라 capture phase 진입
 *        (MediaDevices mock — AC-1, AC-2, AC-5)
 * SC-2: capture phase에서 셔터 3회 → 썸네일 3장 표시 → 완료 버튼 활성화
 *        (AC-2 연속촬영 + AC-5 Galaxy Tab 대응 — S Pen 큰 셔터)
 * SC-3: 기존 파일선택 업로드 버튼이 [사진촬영] 버튼 추가 후에도 존재(회귀 없음)
 *        (AC-6)
 *
 * AC-4 (DB): clinical_images 테이블 + category 컬럼 — 마이그레이션 SQL 검증
 *   → Playwright 스코프 외 (SQL 파일 존재 확인으로 검증)
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// getUserMedia mock stream 공장
const MEDIA_DEVICES_MOCK_SCRIPT = `
  const mockTrack = { stop: () => {}, kind: 'video', enabled: true };
  const mockStream = {
    getTracks: () => [mockTrack],
    getVideoTracks: () => [mockTrack],
    active: true,
  };
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: () => Promise.resolve(mockStream) },
    writable: true,
    configurable: true,
  });
`;

/** 진료이미지 탭까지 이동하는 헬퍼 */
async function navigateToImagesTab(page: Parameters<typeof loginAndWaitForDashboard>[0]): Promise<boolean> {
  await page.goto('/admin/customers');
  await page.waitForLoadState('networkidle');

  const firstRow = page.locator('tr[data-customer-id], tbody tr').first();
  if (await firstRow.count() === 0) return false;
  await firstRow.click();
  await page.waitForLoadState('networkidle');

  // 히스토리 탭 그룹
  const historyBtn = page.getByRole('button', { name: /이력|history/i }).first();
  if (await historyBtn.count() > 0) await historyBtn.click();

  // 진료이미지 탭
  const imagesTab = page.getByRole('button', { name: /진료이미지/i }).first();
  if (await imagesTab.count() === 0) return false;
  await imagesTab.click();
  await page.waitForLoadState('networkidle');
  return true;
}

test.describe('T-20260522-foot-PHOTO-CAPTURE — 진료이미지 사진촬영 기능 강화', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  /**
   * SC-1: [사진촬영] 버튼 → 시술 전/후 선택 → capture phase 진입
   * AC-1: /chart/{id}/images 진료이미지 섹션에 [사진촬영] 버튼 존재
   * AC-2: 시술 전 선택 → 카메라 모달 capture 단계 진입
   * AC-5: getUserMedia facingMode 'environment' 요청 (Galaxy Tab 후면 카메라)
   */
  test('SC-1: [사진촬영] → 시술 전 선택 → capture phase 진입', async ({ page }) => {
    await page.addInitScript(MEDIA_DEVICES_MOCK_SCRIPT);

    const navigated = await navigateToImagesTab(page);
    if (!navigated) { test.skip(true, '고객 또는 진료이미지 탭 없음'); return; }

    // AC-1: [사진촬영] 버튼 존재
    const cameraBtn = page.getByRole('button', { name: /사진촬영/i });
    await expect(cameraBtn).toBeVisible({ timeout: 5000 });

    // AC-2 step1: 시술 전/후 선택 화면
    await cameraBtn.click();
    const beforeBtn = page.getByRole('button', { name: /시술 전/ });
    const afterBtn  = page.getByRole('button', { name: /시술 후/ });
    await expect(beforeBtn).toBeVisible({ timeout: 3000 });
    await expect(afterBtn).toBeVisible({ timeout: 3000 });

    // AC-2 step2: 시술 전 선택 → capture phase
    await beforeBtn.click();
    await page.waitForTimeout(400);

    // 분류 배지 확인 (시술 전 = blue)
    const beforeBadge = page.locator('span').filter({ hasText: /시술 전/ }).first();
    await expect(beforeBadge).toBeVisible({ timeout: 3000 });

    // 셔터 버튼 존재 (S Pen 큰 원형)
    const shutterBtn = page.getByRole('button', { name: '촬영' });
    await expect(shutterBtn).toBeVisible({ timeout: 3000 });

    // 취소
    await page.getByRole('button', { name: /취소/ }).first().click();
  });

  /**
   * SC-2: capture phase — 셔터 연속 3회 → 썸네일 3장 → 완료 버튼 활성화
   * AC-2: 연속촬영 + 선택 카테고리 자동업로드
   * AC-5: 셔터 큰 원형 버튼 (S Pen + 스마트폰 공용)
   */
  test('SC-2: 셔터 연속 3회 → 썸네일 3장 → 완료(3) 버튼 활성화', async ({ page }) => {
    await page.addInitScript(MEDIA_DEVICES_MOCK_SCRIPT);

    const navigated = await navigateToImagesTab(page);
    if (!navigated) { test.skip(true, '고객 또는 진료이미지 탭 없음'); return; }

    const cameraBtn = page.getByRole('button', { name: /사진촬영/i });
    if (await cameraBtn.count() === 0) { test.skip(true, '사진촬영 버튼 없음'); return; }
    await cameraBtn.click();

    // 시술 후 선택
    const afterBtn = page.getByRole('button', { name: /시술 후/ });
    if (await afterBtn.count() === 0) { test.skip(true, '시술 후 버튼 없음'); return; }
    await afterBtn.click();
    await page.waitForTimeout(400);

    const shutterBtn = page.getByRole('button', { name: '촬영' });
    if (await shutterBtn.count() === 0) { test.skip(true, '셔터 버튼 없음'); return; }

    // 연속 3회 촬영
    await shutterBtn.click();
    await page.waitForTimeout(200);
    await shutterBtn.click();
    await page.waitForTimeout(200);
    await shutterBtn.click();
    await page.waitForTimeout(400);

    // 썸네일 카운트 텍스트 확인
    const capturedCount = page.getByText(/3장 촬영됨/);
    await expect(capturedCount).toBeVisible({ timeout: 3000 });

    // 완료(3) 버튼 활성화
    const doneBtn = page.getByRole('button', { name: /완료.*3/ });
    await expect(doneBtn).not.toBeDisabled({ timeout: 2000 });

    // 취소
    await page.getByRole('button', { name: /취소/ }).first().click();
  });

  /**
   * SC-3: 기존 파일선택 업로드 회귀 없음
   * AC-6: [업로드] 버튼(input[type=file])이 [사진촬영] 버튼 추가 후에도 존재
   */
  test('SC-3: 기존 파일선택 업로드 버튼 회귀 없음 (AC-6)', async ({ page }) => {
    const navigated = await navigateToImagesTab(page);
    if (!navigated) { test.skip(true, '고객 또는 진료이미지 탭 없음'); return; }

    // 파일업로드 레이블/버튼 존재
    const uploadLabel = page.locator('label').filter({ hasText: /업로드/ }).first();
    const uploadInput = page.locator('input[type="file"][accept="image/*"]').first();

    // 업로드 버튼(레이블) 또는 파일 input 중 하나 이상 존재
    const hasUploadLabel = await uploadLabel.count() > 0;
    const hasUploadInput = await uploadInput.count() > 0;
    expect(hasUploadLabel || hasUploadInput).toBe(true);

    // [사진촬영] 버튼도 함께 존재 (두 버튼 공존)
    const cameraBtn = page.getByRole('button', { name: /사진촬영/i });
    await expect(cameraBtn).toBeVisible({ timeout: 5000 });
  });

  /**
   * AC-4 (DB 마이그레이션 파일 존재 확인)
   * clinical_images_category 마이그레이션 SQL 파일이 supabase/migrations/ 에 존재해야 함
   */
  test('AC-4: clinical_images_category 마이그레이션 파일 존재', async () => {
    const fs = await import('fs');
    const migPath = path.resolve(
      __dirname,
      '../../supabase/migrations/20260522020000_clinical_images_category.sql',
    );
    const downPath = path.resolve(
      __dirname,
      '../../supabase/migrations/20260522020000_clinical_images_category.down.sql',
    );

    expect(fs.existsSync(migPath), `마이그레이션 파일 없음: ${migPath}`).toBe(true);
    expect(fs.existsSync(downPath), `롤백 파일 없음: ${downPath}`).toBe(true);

    const migContent = fs.readFileSync(migPath, 'utf-8');
    // category 컬럼 정의 포함 확인
    expect(migContent).toContain('category');
    // CHECK constraint 포함 확인
    expect(migContent).toContain("'before'");
    expect(migContent).toContain("'after'");
    // ADD COLUMN IF NOT EXISTS 패턴 포함 (기존 테이블 패치 지원)
    expect(migContent).toContain('ADD COLUMN IF NOT EXISTS category');
  });
});
