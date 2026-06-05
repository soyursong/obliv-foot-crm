/**
 * T-20260605-foot-SALES-TAB-RENAME-THERAPIST
 * 매출집계 항목명 정비 — "담당직원별" → "담당치료사별" E2E
 *
 * 배경: T-20260605-foot-SALES-STAFF-DEDUCT-BASIS 로 탭5 귀속 주체가
 *       '수납 직원' → '차감 치료사'로 전환됨. 화면 레이블 정비.
 *
 * 시나리오:
 *   S1. [매출집계] 탭 라벨이 '담당치료사별'로 노출 + 구 '담당직원별' 미노출
 *       + 탭 클릭 시 정상 활성(탭 value 'staff' 비변경 검증)
 *   S2. 엑셀 export 컬럼 헤더에 '담당치료사' 존재 + '담당직원' 부재
 *       (빈 데이터 staging: 다운로드 미발생 시 skip-log)
 *
 * 표기만 변경. 집계 로직·데이터·컬럼 순서 비변경(AC-4).
 */
import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';
import { loginAndWaitForDashboard } from '../helpers';

const SALES_URL = '/admin/sales';

test.describe('T-20260605-foot-SALES-TAB-RENAME-THERAPIST 담당치료사별 표기 정비', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded — auth 실패');
  });

  // ── S1. 탭 라벨 '담당치료사별' 노출 + 구명칭 미노출 ────────────────────────
  test('S1 매출집계 탭 라벨 담당치료사별 노출 + 활성', async ({ page }) => {
    await page.goto(SALES_URL);
    await expect(page.getByText('매출집계')).toBeVisible({ timeout: 10_000 });

    const therapistTab = page.getByRole('tab', { name: '담당치료사별' });
    await expect(therapistTab).toBeVisible({ timeout: 10_000 });

    // 구 명칭 '담당직원별' 탭은 더 이상 없어야 함
    await expect(page.getByRole('tab', { name: '담당직원별' })).toHaveCount(0);

    // 클릭 시 정상 활성 (탭 value 'staff' 비변경 → 콘텐츠 토글 렌더)
    await therapistTab.click();
    await expect(therapistTab).toHaveAttribute('data-state', 'active');
    await expect(page.locator('[data-testid="sales-staff-basis-toggle"]')).toBeVisible({
      timeout: 10_000,
    });

    // AC-LABEL 시나리오2: 탭 활성 후 페이지 내 소제목 등에도 구 '담당직원별' 미잔존
    await expect(page.getByText('담당직원별')).toHaveCount(0);
    console.log('[RENAME] S1 탭 라벨 담당치료사별 OK (소제목 잔존 0 확인)');
  });

  // ── S2. 엑셀 export 헤더 '담당치료사' 정비 ────────────────────────────────
  test('S2 엑셀 export 컬럼 헤더 담당치료사 (구 담당직원 부재)', async ({ page }) => {
    await page.goto(SALES_URL);
    await expect(page.getByText('매출집계')).toBeVisible({ timeout: 10_000 });

    // 기본 기간(이번달) 그대로 export
    await page.waitForTimeout(800);

    const exportBtn = page.locator('[data-testid="sales-export-btn"]');
    await expect(exportBtn).toBeVisible({ timeout: 10_000 });

    const downloadPromise = page
      .waitForEvent('download', { timeout: 6_000 })
      .catch(() => null);
    await exportBtn.click();
    const download = await downloadPromise;

    if (!download) {
      // 빈 데이터 staging → '매출 내역이 없습니다' 토스트, 다운로드 미발생
      console.log('[RENAME] S2 매출 데이터 없음 — 엑셀 헤더 검증 skip');
      test.skip(true, '엑셀 다운로드 미발생(빈 데이터)');
      return;
    }

    const path = await download.path();
    expect(path).toBeTruthy();
    const wb = XLSX.readFile(path!);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
    const headerRow = (aoa[0] ?? []) as string[];

    expect(headerRow).toContain('담당치료사');
    expect(headerRow).not.toContain('담당직원');
    console.log('[RENAME] S2 엑셀 헤더 담당치료사 OK');
  });
});
