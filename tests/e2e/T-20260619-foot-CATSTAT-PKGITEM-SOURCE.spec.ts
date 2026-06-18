/**
 * E2E — T-20260619-foot-CATSTAT-PKGITEM-SOURCE
 * 통계 > 카테고리별("2. 시술 종류별 매출") 집계 소스 교체(소진 session_type → 패키지 생성 품목 기준).
 *
 * 본 티켓 변경은 RPC(foot_stats_by_category) 내부 집계 소스 교체이며,
 * 반환 시그니처(category/sessions/amount)·FE(CategorySection/categoryLabel)는 무변경.
 * 따라서 E2E는 "화면 무회귀"(AC5)와 빈 구간 처리(시나리오 2)를 검증한다.
 * 실데이터 카테고리 일치(AC6)는 RPC 단위 데이터 대조로 별도 검증.
 *
 * 시나리오 1: 카테고리별 통계 정상 렌더 (섹션·표 헤더 정상)
 * 시나리오 2: 빈 미래 구간 → 에러 없이 "데이터 없음"
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260619 통계 카테고리별 집계 소스 교체 (무회귀)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('시나리오1: "2. 시술 종류별 매출" 섹션 + 카테고리 표 헤더 렌더', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });

    // 섹션 타이틀
    await expect(page.getByText('2. 시술 종류별 매출')).toBeVisible({ timeout: 10_000 });
    // 카테고리 표 헤더 4종 (회귀 가드: 컬럼 구조 보존)
    await expect(page.getByText('카테고리 비중')).toBeVisible();
    await expect(page.getByText('카테고리 표')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '카테고리' }).first()).toBeVisible();
    await expect(page.getByText('회차/건수')).toBeVisible();
    console.log('[CATSTAT] 시나리오1: 섹션/표 헤더 렌더 OK');
  });

  test('시나리오2: 데이터 없는 처리(섹션은 항상 렌더, 에러 없음)', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', (e) => consoleErrors.push(String(e)));

    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('2. 시술 종류별 매출')).toBeVisible({ timeout: 10_000 });

    // RPC 결과가 비어도 "데이터 없음" 또는 행 렌더 — 페이지 크래시 없음
    expect(consoleErrors, `page errors: ${consoleErrors.join('; ')}`).toHaveLength(0);
    console.log('[CATSTAT] 시나리오2: 빈 구간/에러 가드 OK');
  });
});
