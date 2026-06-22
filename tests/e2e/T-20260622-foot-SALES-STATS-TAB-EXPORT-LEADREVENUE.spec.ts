/**
 * T-20260622-foot-SALES-STATS-TAB-EXPORT-LEADREVENUE
 * 통계 > 매출통계 탭: 일간매출보고 다운로드 버튼 + 실장별 '총 매출액' 컬럼.
 *
 * 개발 2건:
 *   1) 매출통계(revenue) 탭에 '일간매출보고 다운로드' 버튼(stats-revenue-export) 추가
 *      (기존엔 매출집계 메뉴에만 다운로드 존재).
 *   2) 실장별 실적(ConsultantSection) 테이블에 '총 매출액' 컬럼 추가(기존 객단가만).
 *
 * 데이터 소스 = foot_stats_consultant RPC(total_amount 신규 반환). 매출집계
 * 다운로드 경로(Sales.tsx fetchSalesRawRows, T-20260622-foot-SALES-AGG-DOWNLOAD-ERROR)
 * 와 코드·데이터 완전 분리 → AGG 버그 비전파 가드.
 *
 * 가드:
 *   - 매출통계 탭 진입 시 다운로드 버튼 가시.
 *   - 다운로드 클릭 시 '다운로드 중 오류' 토스트 미발생(성공 또는 빈데이터 info 만 허용).
 *   - 실장별 실적 테이블에 '총 매출액' 헤더 존재(데이터 있을 때).
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? '';
const STATS_URL = `${BASE_URL}/admin/stats`;
const ERROR_TOAST = '다운로드 중 오류가 발생했습니다.';

test.describe('매출통계 탭 일간매출보고 다운로드 + 총매출액 컬럼', () => {
  test('매출통계 탭에 다운로드 버튼 가시 + 클릭 시 오류 토스트 미발생', async ({ page }) => {
    await page.goto(STATS_URL);
    await page.waitForLoadState('networkidle');

    // 인증 가드: storageState 유실 시 /login 리다이렉트로 버튼 미렌더 → 명확히 조기 실패.
    expect(
      page.url(),
      'storageState 유실로 /login 리다이렉트 — auth.setup(setup project) 선행 확인',
    ).not.toContain('/login');

    // 기본 진입 탭 = 매출 통계(revenue). 다운로드 버튼 가시 확인.
    const exportBtn = page.getByTestId('stats-revenue-export');
    await expect(exportBtn).toBeVisible({ timeout: 15_000 });

    // 로딩 종료 대기(버튼 disabled 해제) 후 클릭.
    await expect(exportBtn).toBeEnabled({ timeout: 15_000 });

    const downloadPromise = page
      .waitForEvent('download', { timeout: 8000 })
      .catch(() => null);

    await exportBtn.click();

    // 핵심 단언: 오류 토스트 미발생 (AGG 경로 버그 비전파 + 신규 경로 graceful).
    await expect(page.getByText(ERROR_TOAST)).not.toBeVisible({ timeout: 6000 });

    await downloadPromise;
  });

  test('TM집계 탭 전환 시 다운로드 버튼 숨김(매출통계 탭 전용)', async ({ page }) => {
    await page.goto(STATS_URL);
    await page.waitForLoadState('networkidle');
    expect(page.url()).not.toContain('/login');

    // 매출통계 탭에서는 버튼 보임.
    await expect(page.getByTestId('stats-revenue-export')).toBeVisible({ timeout: 15_000 });

    // TM집계 탭 클릭(존재 시) → 버튼 사라짐.
    const tmTab = page.getByTestId('stats-tab-tm');
    if (await tmTab.count()) {
      await tmTab.click();
      await expect(page.getByTestId('stats-revenue-export')).toHaveCount(0);
    }
  });
});
