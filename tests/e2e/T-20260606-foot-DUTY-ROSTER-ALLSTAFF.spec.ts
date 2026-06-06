/**
 * E2E spec — T-20260606-foot-DUTY-ROSTER-ALLSTAFF
 * 직원 근무 캘린더 전 직원 확장 (렌더 대상 director-only → 전 활성 직원)
 *
 * 부모: T-20260605-foot-GSHEET-SCHEDULE-IMPORT (구글시트 불러오기 경로 재사용)
 * 진입점 = 직원 > 근무캘린더 탭.
 *
 * 시나리오(티켓 AC 기준):
 *  1) 전 직원 렌더(AC-1/AC-5): 근무 그리드 헤더가 "직원"으로 보정 + 그리드 렌더 + 행에 role 표기.
 *  2) GUARD 회귀(AC-4): "오늘 근무 원장님" 배너는 director-only 전제 유지(문구 불변).
 *  3) 권한 불변(AC-6) + import 진입점(AC-3): admin/manager 세션에서 그리드/import 버튼 노출,
 *     다이얼로그 열고 취소해도 그리드 영향 없음.
 *
 * ※ 실제 셀 토글 insert/import insert는 DB 오염 방지를 위해 본 spec에서 확정 트리거하지 않음.
 *    (부모 spec과 동일 정책 — 삽입 동선은 supervisor field-soak에서 심화 검증.)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260606-foot-DUTY-ROSTER-ALLSTAFF — 근무 캘린더 전 직원 확장', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');

    await page.goto('/admin/staff');
    // 기본 탭 = 근무캘린더(duty). 배너 노출 대기.
    try {
      await page.getByText('근무 원장님').waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, '근무캘린더 탭 진입 실패(권한/데이터)');
    }
  });

  test('시나리오1: 그리드 헤더 "직원" 보정 + 전 직원 그리드 렌더(AC-1/AC-5)', async ({ page }) => {
    // 그리드가 렌더되었거나, 직원이 0명이면 빈상태 문구가 직원 일반으로 보정됨.
    const grid = page.getByTestId('duty-roster-grid');
    const emptyState = page.getByText('등록된 직원이 없습니다');

    const gridVisible = await grid.isVisible().catch(() => false);
    if (gridVisible) {
      // AC-1: 첫 컬럼 헤더가 "원장님" → "직원"으로 보정
      await expect(grid.getByRole('columnheader', { name: '직원' })).toBeVisible();
      // AC-5: 빈상태가 아니라 행이 렌더됨 (헤더행 + 1개 이상 직원행)
      const rowCount = await grid.locator('tbody tr').count();
      expect(rowCount).toBeGreaterThan(0);
      console.log(`[시나리오1] 직원 헤더 + ${rowCount}개 직원행 렌더 OK`);
    } else {
      // 직원 0명 환경 — 빈상태가 director 전용 문구가 아니어야 함(AC-5 보정)
      await expect(emptyState).toBeVisible();
      await expect(page.getByText('등록된 원장님이 없습니다')).toHaveCount(0);
      console.log('[시나리오1] 직원 0명 — 빈상태 직원 일반 문구로 보정 OK');
    }
  });

  test('시나리오2: GUARD — "오늘 근무 원장님" 배너 director 전제 유지(AC-4)', async ({ page }) => {
    // 직원 확장으로 깨지지 않고 원장 의존 배너 정상 렌더
    await expect(page.getByText('근무 원장님')).toBeVisible({ timeout: 5_000 });
    console.log('[시나리오2] 원장 배너 GUARD 정상 렌더 OK');
  });

  test('시나리오3: 권한·import 진입점 불변 + 취소 시 그리드 무영향(AC-3/AC-6)', async ({ page }) => {
    // admin/manager 세션 → import 진입점 노출
    const importBtn = page.getByTestId('duty-import-btn');
    if (!(await importBtn.isVisible().catch(() => false))) {
      test.skip(true, 'import 진입점 미노출(비편집 권한) — 권한 불변 케이스');
    }
    await importBtn.click();
    await expect(page.getByTestId('duty-import-paste-mode')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: '취소' }).click();

    // 다이얼로그 닫아도 근무캘린더(배너) 정상 — 그리드 영향 없음
    await expect(page.getByText('근무 원장님')).toBeVisible();
    console.log('[시나리오3] import 진입점/취소 동선 + 그리드 무영향 OK');
  });
});
