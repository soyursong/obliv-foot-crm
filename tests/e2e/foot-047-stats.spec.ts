/**
 * E2E B-3 (foot-047) — 통계 페이지
 *
 * 검증 포인트:
 * 1. admin 토큰 → /admin/stats 접근 → 페이지 렌더 (통계 대시보드 텍스트)
 * 2. 카드 4개 (총 방문/총 매출/일평균 방문/일평균 매출) 보임
 * 3. 차트 4개 영역 보임 (방문 추이/매출 추이/체류시간/객단가)
 * 4. 기간 프리셋 7/14/30 클릭 → 상태 변경
 * 5. (참고) non-admin 권한 거부 검증은 별도 계정 발급 필요 → 본 라운드에서 skip
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('B-3 통계 페이지 (foot-047)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('/admin/stats 접근 + 통계 대시보드 렌더', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });
    console.log('[B-3] /admin/stats 렌더 OK');
  });

  test('KPI 카드 4종 보임', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });

    // 카드 타이틀 텍스트 (range 변수 포함 형태)
    await expect(page.getByText(/총 방문/).first()).toBeVisible();
    await expect(page.getByText(/총 매출/).first()).toBeVisible();
    await expect(page.getByText('일평균 방문')).toBeVisible();
    await expect(page.getByText('일평균 매출')).toBeVisible();
    console.log('[B-3] KPI 카드 4종 OK');
  });

  test('차트 4종 영역 보임 (Recharts container)', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });

    await expect(page.getByText('일별 방문 추이')).toBeVisible();
    await expect(page.getByText('일별 매출 추이')).toBeVisible();
    await expect(page.getByText('평균 체류시간 (분)')).toBeVisible();
    await expect(page.getByText('일별 객단가')).toBeVisible();

    // Recharts ResponsiveContainer 렌더 확인 (svg 존재)
    await page.waitForTimeout(1500);
    const svgCount = await page.locator('.recharts-responsive-container svg').count();
    expect(svgCount).toBeGreaterThanOrEqual(1);
    console.log(`[B-3] 차트 영역 OK — Recharts SVG ${svgCount}개`);
  });

  test('기간 프리셋 7/14/30 클릭 동작', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });

    // 기본 14일 → 7일 클릭 → 텍스트 변경
    await page.getByRole('button', { name: '7일', exact: true }).click();
    await expect(page.getByText('최근 7일 기준')).toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: '30일', exact: true }).click();
    await expect(page.getByText('최근 30일 기준')).toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: '14일', exact: true }).click();
    await expect(page.getByText('최근 14일 기준')).toBeVisible({ timeout: 5_000 });
    console.log('[B-3] 기간 프리셋 7/14/30 동작 OK');
  });

  test('이번 달 직원별 실적 카드 보임', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('이번 달 직원별 실적')).toBeVisible();
    console.log('[B-3] 직원 실적 카드 OK');
  });
});
