/**
 * T-20260610-foot-STATS-TM-AGGREGATE-TAB — 통계 대시보드 'TM집계' 탭 E2E spec
 *
 * 롱래CRM AdminStats TM 탭 산식을 차용한 풋 TM집계 탭 검증.
 *
 * 검증 대상:
 *   시나리오 1 (정상 동선):
 *     - /admin/stats 진입 → 'TM집계' 탭 존재 (AC-1)
 *     - 'TM집계' 탭 클릭 → KPI 4종(예약등록건수/예약수/내원건수/내원률) 렌더 (AC-2)
 *     - TM상담사별 집계 표 렌더 (AC-2/AC-4)
 *     - 기간 프리셋 변경 시 수치 갱신 (에러 없음) (AC-3)
 *   시나리오 2 (엣지):
 *     - 데이터 없는 기간(미래) 선택 → 에러 배너 없이 빈 상태 표시 (AC-3)
 *   KPI 드릴다운:
 *     - 예약수 카드 클릭 → 상세 팝업(다이얼로그) 오픈
 *
 *  ※ 시나리오 3(TM role 탭 가시성 AC-5/AC-6)은 TM role 계정 토큰이 필요하여
 *    별도 계정 발급 round에서 검증(현 admin 토큰으로는 전체 탭 노출 확인까지).
 *
 * READ-ONLY — DB 변경 없음.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('TM집계 탭 (T-20260610-foot-STATS-TM-AGGREGATE-TAB)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('시나리오1: TM집계 탭 존재 + 클릭 시 KPI·표 렌더 (AC-1/AC-2/AC-4)', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });

    // AC-1: 'TM집계' 탭이 별도 탭으로 노출
    const tmTab = page.getByTestId('stats-tab-tm');
    await expect(tmTab).toBeVisible();

    // 'TM집계' 탭 클릭
    await tmTab.click();
    await page.waitForLoadState('networkidle');

    // AC-2: KPI 4종 라벨 표시
    await expect(page.getByText('예약등록건수').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('예약수').first()).toBeVisible();
    await expect(page.getByText('내원건수').first()).toBeVisible();
    await expect(page.getByText('내원률').first()).toBeVisible();

    // AC-2/AC-4: TM상담사별 집계 표
    await expect(page.getByText('TM상담사별 집계')).toBeVisible();
    console.log('[TM집계] 탭 + KPI 4종 + 표 렌더 OK');
  });

  test('시나리오1: 기간 프리셋 변경 시 에러 없이 갱신 (AC-3)', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('stats-tab-tm').click();
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: '오늘', exact: true }).click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: '이번 달', exact: true }).click();
    await page.waitForLoadState('networkidle');

    // 에러 배너 미노출
    await expect(page.getByText(/통계를 불러오지 못했습니다/)).toHaveCount(0);
    // 표는 계속 존재
    await expect(page.getByText('TM상담사별 집계')).toBeVisible();
    console.log('[TM집계] 기간 프리셋 갱신 OK (에러 없음)');
  });

  test('시나리오2: 미래(빈 데이터) 기간 → 에러 없이 빈 상태 (AC-3)', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('stats-tab-tm').click();
    await page.waitForLoadState('networkidle');

    // 사용자 지정 → 먼 미래 기간
    await page.getByRole('button', { name: '사용자 지정', exact: true }).click();
    const dateInputs = page.locator('input[type="date"]');
    await dateInputs.nth(0).fill('2099-01-01');
    await dateInputs.nth(1).fill('2099-01-31');
    await page.waitForLoadState('networkidle');

    // 에러 배너 없이 빈 상태('데이터 없음') 표시
    await expect(page.getByText(/통계를 불러오지 못했습니다/)).toHaveCount(0);
    await expect(page.getByText('데이터 없음').first()).toBeVisible({ timeout: 10_000 });
    console.log('[TM집계] 빈 데이터 기간 → 빈 상태 OK');
  });

  test('KPI 드릴다운: 예약수 카드 클릭 → 상세 팝업 오픈', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('stats-tab-tm').click();
    await page.waitForLoadState('networkidle');

    // '예약수' KPI 카드(버튼) 클릭
    await page.getByRole('button', { name: /예약수/ }).first().click();

    // 다이얼로그 오픈 + CSV 다운로드 버튼 존재
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: 'CSV 다운로드' })).toBeVisible();
    console.log('[TM집계] KPI 드릴다운 팝업 OK');
  });
});
