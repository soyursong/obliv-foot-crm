/**
 * E2E spec — T-20260609-foot-MEDIMG-COMPARE-GRID
 * 고객 차트(2번차트) 진료이미지 멀티셀렉트 → 적응형 비교 그리드 오버레이
 *
 * AC-1: 2~4장 멀티셀렉트 → "비교" 액션 → 그리드 오버레이 (2장=1×2, 3~4장=2×2)
 *       4장 초과 선택 시 비교 차단 / 2장 미만은 비활성
 * AC-2: 각 셀 하단 날짜·분류 라벨 (개별 이미지 메모 데이터 부재 → 분류로 식별)
 * AC-3: 닫기 → 목록 복귀, 선택 상태(selectMode) 무손상
 * AC-4: 업로드/단일보기/삭제 등 기존 동작 무변경, 비교 뷰 read-only
 *
 * 데이터 의존: 진료이미지 2장 이상 있어야 검증 가능 → 부족 시 graceful skip.
 * (IMG-VIEWER-UX / MEDIMG-CAMERA spec 패턴 준수)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260609-foot-MEDIMG-COMPARE-GRID — 진료이미지 비교 그리드', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  /** 진료이미지 탭으로 이동. 성공 시 true, 진입 불가 시 false */
  async function gotoImagesTab(page: Parameters<typeof loginAndWaitForDashboard>[0]) {
    await page.goto('/admin/customers');
    await page.waitForLoadState('networkidle');
    const firstRow = page.locator('tr[data-customer-id], tbody tr').first();
    if (await firstRow.count() === 0) return false;
    await firstRow.click();
    await page.waitForLoadState('networkidle');
    const chartBtn = page.getByRole('button', { name: /고객차트\(2번\)|2번차트|고객차트/ }).first();
    if (await chartBtn.count() === 0) return false;
    await chartBtn.click();
    await page.waitForTimeout(1500);
    const imagesTab = page.getByRole('button', { name: /진료이미지/i }).first();
    if (await imagesTab.count() === 0) return false;
    await imagesTab.click();
    await page.waitForTimeout(1000);
    return true;
  }

  /** 선택 모드 진입 + 첫 N장 썸네일 선택. 선택 성공 수 반환 */
  async function enterSelectAndPick(
    page: Parameters<typeof loginAndWaitForDashboard>[0],
    n: number,
  ): Promise<number> {
    const selectBtn = page.getByRole('button', { name: /^선택$/ }).first();
    if (await selectBtn.count() === 0) return 0;
    await selectBtn.click();
    const thumb = page.getByTestId('treat-img-thumb');
    const total = await thumb.count();
    const pick = Math.min(n, total);
    for (let i = 0; i < pick; i++) {
      await thumb.nth(i).click();
      await page.waitForTimeout(120);
    }
    return pick;
  }

  // ── 시나리오 1: 2장 비교 (AC-1, AC-2) ───────────────────────────────
  test('S1: 2장 선택 → 비교 그리드 오버레이 + 날짜·분류 라벨', async ({ page }) => {
    if (!(await gotoImagesTab(page))) { test.skip(true, '진료이미지 탭 진입 불가'); return; }
    const picked = await enterSelectAndPick(page, 2);
    if (picked < 2) { test.skip(true, '진료이미지 2장 미만'); return; }

    const compareBtn = page.getByTestId('compare-btn');
    await expect(compareBtn).toBeEnabled();
    await expect(compareBtn).toContainText('(2)');
    await compareBtn.click();

    const overlay = page.getByTestId('img-compare');
    await expect(overlay).toBeVisible({ timeout: 3000 });

    // 셀 2개 + 각 셀 날짜(yyyy-mm-dd) 라벨
    const cells = page.getByTestId('compare-cell');
    await expect(cells).toHaveCount(2);
    await expect(cells.first()).toContainText(/\d{4}-\d{2}-\d{2}/);
  });

  // ── 시나리오 2: 닫기 → 목록 복귀, 선택 상태 보존 (AC-3) ──────────────
  test('S2: 비교 오버레이 닫기 → 목록 복귀 + 선택 모드 유지', async ({ page }) => {
    if (!(await gotoImagesTab(page))) { test.skip(true, '진료이미지 탭 진입 불가'); return; }
    const picked = await enterSelectAndPick(page, 2);
    if (picked < 2) { test.skip(true, '진료이미지 2장 미만'); return; }

    await page.getByTestId('compare-btn').click();
    const overlay = page.getByTestId('img-compare');
    await expect(overlay).toBeVisible({ timeout: 3000 });

    await page.getByTestId('compare-close').click();
    await expect(overlay).not.toBeVisible({ timeout: 3000 });

    // 선택 상태 무손상: 비교 버튼이 여전히 (2)로 노출 (selectMode 유지)
    await expect(page.getByTestId('compare-btn')).toContainText('(2)');
  });

  // ── 시나리오 3: 4장 초과 차단 (AC-1) ────────────────────────────────
  test('S3: 5장 선택 시 비교 버튼 비활성 (최대 4장)', async ({ page }) => {
    if (!(await gotoImagesTab(page))) { test.skip(true, '진료이미지 탭 진입 불가'); return; }
    const picked = await enterSelectAndPick(page, 5);
    if (picked < 5) { test.skip(true, '진료이미지 5장 미만 — 상한 검증 불가'); return; }

    const compareBtn = page.getByTestId('compare-btn');
    await expect(compareBtn).toContainText('(5)');
    await expect(compareBtn).toBeDisabled();
  });

  // ── AC-4: 무파괴 — 업로드/촬영 버튼 + 단일 라이트박스 유지 ────────────
  test('AC-4: 비교 기능 추가가 기존 업로드·촬영·단일뷰어를 깨지 않는다', async ({ page }) => {
    if (!(await gotoImagesTab(page))) { test.skip(true, '진료이미지 탭 진입 불가'); return; }
    await expect(page.getByRole('button', { name: /업로드/ }).first()).toBeVisible({ timeout: 3000 });
    await expect(page.getByRole('button', { name: /사진촬영/ }).first()).toBeVisible();

    // 선택모드 아닐 때 썸네일 클릭 → 단일 라이트박스 (비교 아님)
    const thumb = page.getByTestId('treat-img-thumb');
    if (await thumb.count() > 0) {
      await thumb.first().click();
      await expect(page.getByTestId('img-lightbox')).toBeVisible({ timeout: 3000 });
      await expect(page.getByTestId('img-compare')).toHaveCount(0);
    }
  });
});
