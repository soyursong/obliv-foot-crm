/**
 * E2E spec — T-20260818-foot-STATS-PERIOD-QUERY-ERROR (P2)
 *
 * 증상(현장 리포트): 통계 화면에서 기간(날짜 범위) 설정 후 조회 시 오류 발생.
 *
 * 진단(read-only, live 실측):
 *   · DB 레벨 RPC/조회는 실사용자(admin/manager/director) 기준 전 기간조합에서 정상.
 *   · 확정 결함 = 매출탭 fetchMtmCardMetrics 의 payments/check_ins/closing_manual_payments/
 *     package_sessions 조회가 페이지네이션 없이 실행 → PostgREST 기본 1000행 cap 에서 장기간
 *     조회 시 무단 절단(live: 92d payments count=1299 vs fetched=1000) → 매출·내원 KPI 과소집계.
 *   · 부차 결함 = 사용자 지정 기간 역순(from>to) 입력 시 빈결과/오해 소지.
 *
 * 수정(no db_change):
 *   · fetchMtmCardMetrics 4개 조회를 cursor(.range) 페이지네이션(fetchAllRows)으로 전행 수집.
 *   · resolveRange custom 역순(from>to) → 정규 범위로 스왑.
 *
 * 검증(브라우저):
 *   S1: 매출탭 + 사용자 지정 장기간(92d) 조회 → 오류 배너 미노출 + 매출 KPI 렌더.
 *   S2: 사용자 지정 역순(to<from) 입력 → 오류 배너 미노출 + 정상 렌더(스왑 정규화).
 *   S3: 월경계(7/15~8/15) 조회 회귀 → 오류 배너 미노출.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const ERROR_BANNER = /통계를 불러오지 못했습니다/;

test.describe('T-20260818 STATS-PERIOD-QUERY-ERROR — 통계 기간조회 오류 제거', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — 스킵');
  });

  async function gotoRevenueTab(page: import('@playwright/test').Page) {
    await page.goto('/admin/stats');
    await page.getByText('통계 대시보드', { exact: true }).first().waitFor({ timeout: 20_000 });
    const revTab = page.getByTestId('stats-tab-revenue');
    if (await revTab.count() === 0) {
      test.skip(true, '매출 통계 탭 미표시(권한/환경) — 스킵');
      return false;
    }
    await revTab.click();
    return true;
  }

  async function setCustomRange(page: import('@playwright/test').Page, from: string, to: string) {
    await page.getByRole('button', { name: '사용자 지정' }).click();
    const dates = page.locator('input[type="date"]');
    await dates.nth(0).fill(from);
    await dates.nth(1).fill(to);
  }

  test('S1: 사용자 지정 장기간(92일) 조회 — 오류 배너 미노출 + 매출 KPI 렌더', async ({ page }) => {
    if (!(await gotoRevenueTab(page))) return;
    await setCustomRange(page, '2026-05-18', '2026-08-18');
    // 매출 KPI(총 매출/객단가) 렌더 대기 — 절단·throw 없이 로드 완료되어야 함.
    await expect(page.getByText('총 매출').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(ERROR_BANNER)).toHaveCount(0);
  });

  test('S2: 사용자 지정 역순(to<from) 입력 — 오류 배너 미노출 + 정상 렌더(스왑 정규화)', async ({ page }) => {
    if (!(await gotoRevenueTab(page))) return;
    // 종료일을 시작일보다 앞으로: resolveRange 가 스왑해 정상 범위로 조회.
    await setCustomRange(page, '2026-08-18', '2026-08-01');
    await expect(page.getByText('총 매출').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(ERROR_BANNER)).toHaveCount(0);
  });

  test('S3: 월경계(2026-07-15~2026-08-15) 조회 회귀 — 오류 배너 미노출', async ({ page }) => {
    if (!(await gotoRevenueTab(page))) return;
    await setCustomRange(page, '2026-07-15', '2026-08-15');
    await expect(page.getByText('총 매출').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(ERROR_BANNER)).toHaveCount(0);
  });
});
