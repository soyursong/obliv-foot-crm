/**
 * E2E spec — T-20260601-foot-CHART-IMG-VIEWER-UX
 * 고객 차트(2번차트) 진료이미지 뷰어 UX 3건
 *
 * 이슈1 (AC-1): 일자별 이미지 이력 아코디언 토글 정상 + 진입 시 최신 날짜만 펼침
 * 이슈2 (AC-2): 진료이미지 클릭 → 라이트박스 모달 + ◀/▶ 좌우 넘김 + 키보드 + 경계 처리
 * 이슈3 (AC-3): 그룹 전체 다운로드 / 선택 다운로드 두 경로
 * AC-4: 기존 업로드·삭제·회전 무파괴
 *
 * 데이터 의존: 진료이미지가 실제로 있어야 검증 가능한 항목은 graceful skip.
 * (CI/로컬 시드 상태에 따라 이미지 0장일 수 있음 — MEDIMG-CAMERA spec 패턴 준수)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260601-foot-CHART-IMG-VIEWER-UX — 진료이미지 뷰어 UX 3건', () => {
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
    // 2번차트는 시트로 열리는 버튼 "고객차트(2번)" (링크 아님)
    const chartBtn = page.getByRole('button', { name: /고객차트\(2번\)|2번차트|고객차트/ }).first();
    if (await chartBtn.count() === 0) return false;
    await chartBtn.click();
    await page.waitForTimeout(1500);
    // 진료이미지 탭 (차트 시트 내 탭 버튼, 별도 히스토리 그룹 불필요)
    const imagesTab = page.getByRole('button', { name: /진료이미지/i }).first();
    if (await imagesTab.count() === 0) return false;
    await imagesTab.click();
    await page.waitForTimeout(1000);
    return true;
  }

  /** 일자 헤더(아코디언 토글 버튼) — "일자별 이미지 이력" 영역 내 날짜 + N장 라벨 버튼 */
  function dateHeaders(page: Parameters<typeof loginAndWaitForDashboard>[0]) {
    return page.locator('button:has-text("장")').filter({ hasText: /\d{4}-\d{2}-\d{2}/ });
  }

  // ── 시나리오 1: 이력 접힘 토글 (AC-1) ──────────────────────────────
  test('S1: 일자별 이미지 이력 헤더 클릭 시 펼침↔접힘 정상 토글', async ({ page }) => {
    if (!(await gotoImagesTab(page))) { test.skip(true, '진료이미지 탭 진입 불가'); return; }

    const headers = dateHeaders(page);
    if (await headers.count() === 0) { test.skip(true, '진료이미지 날짜 그룹 없음'); return; }

    const firstHeader = headers.first();
    const thumb = page.getByTestId('treat-img-thumb');

    // 진입 직후: 최신(첫) 그룹만 펼침 → 썸네일 보임
    await expect(thumb.first()).toBeVisible({ timeout: 5000 });
    const openCount = await thumb.count();

    // 첫 헤더 클릭 → 접힘 → 해당 그룹 썸네일 사라짐 (전체 썸네일 수 감소)
    await firstHeader.click();
    await page.waitForTimeout(300);
    const afterCollapse = await thumb.count();
    expect(afterCollapse).toBeLessThan(openCount);

    // 다시 클릭 → 펼침 → 썸네일 복귀
    await firstHeader.click();
    await page.waitForTimeout(300);
    expect(await thumb.count()).toBe(openCount);
  });

  // ── 시나리오 2: 확대 좌우 넘김 (AC-2) ──────────────────────────────
  test('S2: 진료이미지 클릭 시 라이트박스 모달 + ◀/▶ 넘김 + 경계 처리', async ({ page }) => {
    if (!(await gotoImagesTab(page))) { test.skip(true, '진료이미지 탭 진입 불가'); return; }

    const thumb = page.getByTestId('treat-img-thumb');
    if (await thumb.count() === 0) { test.skip(true, '진료이미지 없음'); return; }

    // 첫 썸네일 클릭 → 라이트박스 모달 표시
    await thumb.first().click();
    const lightbox = page.getByTestId('img-lightbox');
    await expect(lightbox).toBeVisible({ timeout: 3000 });

    const indexLabel = page.getByTestId('lightbox-index');
    await expect(indexLabel).toContainText('1 /');

    const total = await thumb.count(); // 같은 그룹 썸네일 수 (펼친 그룹 기준)
    const nextBtn = page.getByTestId('lightbox-next');
    const prevBtn = page.getByTestId('lightbox-prev');

    // 첫 이미지에서 prev는 비활성 (경계)
    await expect(prevBtn).toBeDisabled();

    if (total > 1) {
      // ▶ → 인덱스 2/...
      await nextBtn.click();
      await expect(indexLabel).toContainText('2 /');
      // ◀ → 다시 1/...
      await prevBtn.click();
      await expect(indexLabel).toContainText('1 /');
      // 키보드 → 다음
      await page.keyboard.press('ArrowRight');
      await expect(indexLabel).toContainText('2 /');
    } else {
      // 1장뿐이면 next도 비활성
      await expect(nextBtn).toBeDisabled();
    }

    // Esc로 닫기
    await page.keyboard.press('Escape');
    await expect(lightbox).not.toBeVisible({ timeout: 3000 });
  });

  // ── 시나리오 3: 내려받기 (AC-3) ────────────────────────────────────
  test('S3: 전체 다운로드 / 선택 다운로드 두 경로 제공', async ({ page }) => {
    if (!(await gotoImagesTab(page))) { test.skip(true, '진료이미지 탭 진입 불가'); return; }

    const thumb = page.getByTestId('treat-img-thumb');
    if (await thumb.count() === 0) { test.skip(true, '진료이미지 없음'); return; }

    // (a) 그룹 전체 다운로드 버튼 존재 (펼친 그룹)
    const allDownloadBtn = page.getByRole('button', { name: /전체 다운로드/ }).first();
    await expect(allDownloadBtn).toBeVisible({ timeout: 3000 });

    // (b) 선택 모드 진입
    const selectBtn = page.getByRole('button', { name: /^선택$/ }).first();
    await expect(selectBtn).toBeVisible();
    await selectBtn.click();

    // 선택 다운로드 버튼 노출 (초기 0개 → disabled)
    const selDownloadBtn = page.getByRole('button', { name: /선택 다운로드/ });
    await expect(selDownloadBtn).toBeVisible({ timeout: 3000 });
    await expect(selDownloadBtn).toBeDisabled();

    // 썸네일 1개 선택 → 카운트 1, 버튼 활성
    await thumb.first().click();
    await page.waitForTimeout(200);
    await expect(selDownloadBtn).toContainText('(1)');
    await expect(selDownloadBtn).toBeEnabled();

    // 선택 모드에서는 라이트박스가 열리지 않아야 함 (클릭=선택)
    await expect(page.getByTestId('img-lightbox')).toHaveCount(0);

    // 취소 → 선택 모드 종료
    await page.getByRole('button', { name: /^취소$/ }).first().click();
    await expect(page.getByRole('button', { name: /^선택$/ }).first()).toBeVisible({ timeout: 3000 });
  });

  // ── AC-4: 무파괴 — 업로드/촬영 버튼 유지 ──────────────────────────
  test('AC-4: 라이트박스/다운로드 추가가 기존 업로드·촬영 버튼을 깨지 않는다', async ({ page }) => {
    if (!(await gotoImagesTab(page))) { test.skip(true, '진료이미지 탭 진입 불가'); return; }
    await expect(page.getByRole('button', { name: /업로드/ }).first()).toBeVisible({ timeout: 3000 });
    await expect(page.getByRole('button', { name: /사진촬영/ }).first()).toBeVisible();
  });
});
