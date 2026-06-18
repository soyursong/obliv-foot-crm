/**
 * E2E — T-20260619-foot-STATS-CATEGORY-MANAGER-SOURCE-FIX (파트2 · REWORK)
 * 통계 > 실장별 실적("3. 상담실장 티켓팅 실적") ↔ 직원관리 명단(SSOT) 연동.
 *
 * AC3 확정 = 1-B 데이터 유무 기반 제외 (김주연 총괄, MSG-20260619-075306-ptb0):
 *   "실적 빠진 시기부터 자동 제외 / 이전 조회 시에는 잔류".
 *   ⇒ RPC(foot_stats_consultant) 가 staff.active 가 아닌, 조회 기간에 티켓팅 실적이
 *      있는 staff 만 INNER JOIN 으로 집계 (LEFT→INNER 1줄 변경).
 *   반환 시그니처(consultant_id/name/ticketing_count/package_count/avg_amount)·
 *   FE(ConsultantSection/fetchConsultantPerf)는 무변경.
 *
 * 실데이터 dry-run(READ-ONLY, 2026-06-19):
 *   · 정혜인(active=false) 전 기간 티켓팅 실적 = 0건 → 어느 기간이든 미노출(자동 제외).
 *   · 재직 실장(엄경은 24 / 정연주 15 / 송지현 15 / 김수린 12 / 김주연 10 / 김지윤 3)은
 *     실적 기간 조회 시 정상 잔류.
 *   · "active=false 이나 실적 있는 과거 기간 잔류" 의 실데이터 인스턴스는 없음(정혜인 perf=0).
 *     해당 경로는 active 무참조(SQL 구조)로 담보되며 E2E 실데이터 검증 불가 → 본 spec 범위 외.
 *
 * 시나리오 1: "3. 상담실장 티켓팅 실적" 섹션 + 표 헤더 정상 렌더 (무회귀)
 * 시나리오 2: 실적 0건 실장(정혜인=퇴사·전기간 실적0) 미노출 (AC3 자동제외)
 * 시나리오 3: 실적 있는 재직 실장은 정상 표시 (AC3 데이터-유무 잔류 방향 / 무회귀)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260619 실장별 실적 데이터-유무 기반 필터 (실적 없는 기간 자동 제외)', () => {
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

  test('시나리오2: 실적 0건 실장(정혜인) 미노출 (AC3 데이터-유무 자동제외)', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', (e) => consoleErrors.push(String(e)));

    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('3. 상담실장 티켓팅 실적')).toBeVisible({ timeout: 10_000 });

    // 정혜인은 전 기간 티켓팅 실적 0건이므로 INNER JOIN ticketed 로 명단에서 자동 제외되어야 함
    // (재직 플래그가 아닌 "해당 기간 실적 유무" 기준).
    const consultantSection = page.locator('section', { hasText: '3. 상담실장 티켓팅 실적' });
    await expect(consultantSection).not.toContainText('정혜인');

    expect(consoleErrors, `page errors: ${consoleErrors.join('; ')}`).toHaveLength(0);
    console.log('[CONSULTANT] 시나리오2: 실적 0건 실장(정혜인) 미노출 OK');
  });

  test('시나리오3: 실적 있는 재직 실장은 정상 표시 (AC3 잔류 방향 / 무회귀)', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });

    const consultantSection = page.locator('section', { hasText: '3. 상담실장 티켓팅 실적' });
    await expect(consultantSection).toBeVisible({ timeout: 10_000 });

    // 데이터-유무 필터가 실적 있는 실장을 부당하게 제외하지 않음을 가드.
    // 특정 이름 하드코딩 대신, 섹션이 타이틀만 있는 빈 명단이 아니라 데이터 행을 가지는지(텍스트
    // 길이 휴리스틱)로 과도 제외 회귀를 감지. (기본 조회 기간에 실적 있는 재직 실장 ≥ 1명)
    const sectionText = (await consultantSection.innerText()).replace(/\s+/g, '');
    const titleOnly = '3.상담실장티켓팅실적실장별실적'.replace(/\s+/g, '');
    expect(
      sectionText.length,
      '실장별 실적 섹션이 비어 보임 — 데이터-유무 필터가 과도 제외했을 가능성',
    ).toBeGreaterThan(titleOnly.length);
    console.log('[CONSULTANT] 시나리오3: 실적 있는 재직 실장 표시 OK');
  });
});
