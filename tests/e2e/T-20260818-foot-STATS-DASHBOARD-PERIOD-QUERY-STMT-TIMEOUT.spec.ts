/**
 * E2E spec — T-20260818-foot-STATS-DASHBOARD-PERIOD-QUERY-STMT-TIMEOUT (P1 hotfix)
 *
 * 증상: 통계 대시보드 TM집계 탭에서 넓은 기간(17d+) 조회 시 PostgreSQL statement timeout(57014)
 *       → "통계를 불러오지 못했습니다: ... statement timeout" 오류 배너.
 *
 * 근본원인(read-only 진단):
 *   fetchTmAggregate 가 기간 내 전 raw 행(jongno-foot: 17d 3,410행 / 48d 5,554행)을 1000/page
 *   페이지네이션(5~7 페이지)하며 각 페이지에 customers(name, phone) PHI embed 를 붙여 전 행을
 *   복호화 → DB compute 포화 시(자매 P0 NEWRESV 57014 RC=storage.search 폭주) CPU-starved 로
 *   authenticated statement_timeout(8s) 초과.
 *
 * 수정(no db_change): hot 집계 fetch 에서 customers PHI embed 제거(customer_id 만 fetch),
 *   고객명/전화는 KPI 드릴다운 열릴 때만 fetchTmDetailCustomers 로 소수 subset 지연조회.
 *
 * 검증:
 *   S1: TM집계 탭 + 사용자 지정 17d(2026-08-01~2026-08-17) 조회 → 오류 배너 미노출 + KPI 카드 렌더.
 *   S2: 넓은 기간(월 프리셋) 회귀 → timeout 미발생.
 *   S3: KPI 드릴다운 → 상세표 렌더(고객명 지연조회 경로 회귀 가드).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const ERROR_BANNER = /통계를 불러오지 못했습니다/;

test.describe('T-20260818 STATS-DASHBOARD-PERIOD-QUERY-STMT-TIMEOUT — TM집계 기간조회 timeout 제거', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — 스킵');
  });

  async function gotoTmTab(page: import('@playwright/test').Page) {
    await page.goto('/admin/stats');
    // 통계 대시보드 헤더
    await page.getByText('통계 대시보드', { exact: true }).first().waitFor({ timeout: 20_000 });
    const tmTab = page.getByTestId('stats-tab-tm');
    if (await tmTab.count() === 0) {
      test.skip(true, 'TM집계 탭 미표시(권한/환경) — 스킵');
      return false;
    }
    await tmTab.click();
    return true;
  }

  test('S1: 사용자 지정 17일(2026-08-01~2026-08-17) 조회 — 오류 배너 미노출 + KPI 카드 렌더', async ({ page }) => {
    if (!(await gotoTmTab(page))) return;

    // 사용자 지정 프리셋 → 날짜 입력
    await page.getByRole('button', { name: '사용자 지정' }).click();
    const dates = page.locator('input[type="date"]');
    await dates.nth(0).fill('2026-08-01');
    await dates.nth(1).fill('2026-08-17');

    // 집계 로딩 대기(넉넉히) 후 KPI 카드 존재 확인
    await expect(page.getByText('예약등록건수').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('내원건수').first()).toBeVisible();

    // ★ 핵심 AC: statement timeout 오류 배너가 뜨지 않아야 함
    await expect(page.getByText(ERROR_BANNER)).toHaveCount(0);
  });

  test('S2: 넓은 기간(이번 달 프리셋) 회귀 — timeout 미발생', async ({ page }) => {
    if (!(await gotoTmTab(page))) return;
    await page.getByRole('button', { name: '이번 달' }).click();
    await expect(page.getByText('예약등록건수').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(ERROR_BANNER)).toHaveCount(0);
  });

  test('S3: KPI 드릴다운 — 고객명 지연조회 경로 회귀 가드', async ({ page }) => {
    if (!(await gotoTmTab(page))) return;
    await page.getByRole('button', { name: '이번 달' }).click();
    const kpi = page.getByText('예약등록건수').first();
    await expect(kpi).toBeVisible({ timeout: 30_000 });
    await kpi.click(); // 드릴다운 다이얼로그 오픈 → fetchTmDetailCustomers 트리거
    // 상세표 헤더(고객명 컬럼) 렌더 확인. 지연조회 실패해도 카운트/표 골격은 유지되어야 함.
    await expect(page.getByText('고객명').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(ERROR_BANNER)).toHaveCount(0);
  });
});
