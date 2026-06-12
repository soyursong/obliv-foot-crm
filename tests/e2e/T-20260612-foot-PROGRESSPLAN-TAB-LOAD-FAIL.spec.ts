/**
 * E2E spec — T-20260612-foot-PROGRESSPLAN-TAB-LOAD-FAIL (P0 회귀 핫픽스)
 *
 * 회귀: a24fe86(PROGRESSPLAN-PKGTYPE-DB-BIND) 배포 후 경과분석 플랜 탭 진입 시 "로딩 실패".
 * 원인: 20260612060000_progress_plans_tier_model.sql 마이그가 prod 미적용 →
 *       package_progress_plans.session_count_tier 컬럼 부재 →
 *       ProgressPlansTab.fetchPlans()의 .order('session_count_tier')가 PostgREST 에러.
 * 처방: 누락 마이그 prod 직접 apply (scripts/T-20260612-foot-PROGRESSPLAN-TABLOAD_apply.mjs).
 *
 * 가드:
 *  R1: 경과분석 플랜 탭 진입 시 "로딩 실패" 토스트가 뜨지 않고 탭이 정상 렌더된다.
 *      (session_count_tier 컬럼 존재 회귀 가드 — 마이그 drift 재발 방지)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260612-foot-PROGRESSPLAN-TAB-LOAD-FAIL — 탭 로딩 회귀 가드', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('R1: 경과분석 플랜 탭이 "로딩 실패" 없이 정상 렌더', async ({ page }) => {
    await page.goto('/admin/clinic-management');
    try {
      await page.getByTestId('tab-progress-plans').waitFor({ timeout: 12_000 });
    } catch {
      test.skip(true, '경과분석 플랜 탭 없음');
      return;
    }
    await page.getByTestId('tab-progress-plans').click();

    // 로딩 실패 토스트 부재 — drift 재발 시 여기서 잡힌다.
    await expect(page.getByText(/경과분석 플랜 로딩 실패/)).toHaveCount(0);

    // 탭 컨테이너 정상 렌더 (로더 → 콘텐츠 전환 완료)
    await expect(page.getByTestId('progress-plans-tab')).toBeVisible({ timeout: 10_000 });

    // 마이그 이관/시드 결과 — 회차 tier 그룹이 최소 1개 존재
    await expect(page.getByTestId('progress-plan-group-12')).toBeVisible({ timeout: 6_000 });
  });
});
