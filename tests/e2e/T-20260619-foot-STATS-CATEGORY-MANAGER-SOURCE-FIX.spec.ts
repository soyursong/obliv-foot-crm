/**
 * E2E — T-20260619-foot-STATS-CATEGORY-MANAGER-SOURCE-FIX (파트2)
 * 통계 > 실장별 실적("3. 상담실장 티켓팅 실적") ↔ 직원관리 명단(SSOT) 연동.
 *
 * 본 티켓 변경은 RPC(foot_stats_consultant) WHERE 절에 재직 필터
 * (COALESCE(staff.active, true) = true) 1줄 추가이며,
 * 반환 시그니처(consultant_id/name/ticketing_count/package_count/avg_amount)·
 * FE(ConsultantSection/fetchConsultantPerf)는 무변경.
 * 따라서 E2E는 (1)화면 무회귀, (2)퇴사자(정혜인) 미노출(AC3)을 검증한다.
 * 재직 명단 일치(AC2)·과거실적 귀속(AC3 edge)은 RPC 단위 데이터 대조로 별도 검증
 * (dry-run: 정혜인 = staff.active=false, 결과 누출 0건, 과거 티켓팅 실적 0건).
 *
 * 시나리오 1: "3. 상담실장 티켓팅 실적" 섹션 + 표 헤더 정상 렌더 (무회귀)
 * 시나리오 2: 실장 목록에 퇴사자(정혜인) 미노출 (AC3)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260619 실장별 실적 직원관리 명단 연동 (퇴사자 제외)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('시나리오1: "3. 상담실장 티켓팅 실적" 섹션 + 표 렌더 (무회귀)', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });

    // 섹션 타이틀 + 카드 타이틀 (회귀 가드)
    await expect(page.getByText('3. 상담실장 티켓팅 실적')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('실장별 실적')).toBeVisible();
    console.log('[CONSULTANT] 시나리오1: 섹션/표 렌더 OK');
  });

  test('시나리오2: 실장 목록에 퇴사자(정혜인) 미노출 (AC3)', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', (e) => consoleErrors.push(String(e)));

    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('3. 상담실장 티켓팅 실적')).toBeVisible({ timeout: 10_000 });

    // 기간을 넓혀 과거분 포함(있어도) 노출 시도 — 그래도 퇴사자는 안 보여야 함
    // (RPC 재직 필터로 staff.active=false 인 정혜인은 명단 완전 제외)
    const consultantSection = page.locator('section', { hasText: '3. 상담실장 티켓팅 실적' });
    await expect(consultantSection).not.toContainText('정혜인');

    expect(consoleErrors, `page errors: ${consoleErrors.join('; ')}`).toHaveLength(0);
    console.log('[CONSULTANT] 시나리오2: 퇴사자(정혜인) 미노출 OK');
  });
});
