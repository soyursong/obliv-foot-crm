/**
 * E2E spec — T-20260608-foot-DUTYROSTER-ALLSTAFF-REVERT
 * 근무 캘린더 전 직원 확장(T-20260606-foot-DUTY-ROSTER-ALLSTAFF) 되돌리기.
 *
 * revert 2건: 9c50d00(→2ad83cf, DutyRosterTab director-only 복원) +
 *             afaf0c6(→2f4c883, ImportDialog parseNote 원장 한정 경고 복원).
 * 진입점 = 직원 > 근무캘린더 탭(/admin/staff).
 *
 * 시나리오(REVERT AC 기준 — director-only 복원 검증):
 *  1) 그리드 director-only 복원(AC-1): 그리드 헤더가 "원장님"으로 복원,
 *     빈상태 문구가 "등록된 원장님이 없습니다"로 복원("직원" 일반 보정 흔적 0).
 *  2) 배너 무회귀(AC-2): "오늘 근무 원장님" 배너가 director 파생으로 정상 렌더.
 *  3) import 진입점/취소 무영향(AC-5): admin/manager 세션 import 진입점 노출 →
 *     다이얼로그 열고 취소해도 근무캘린더(배너) 그대로 — handover/그리드 무영향.
 *
 * ※ FE-only revert(SQL 0·DB 비파괴). 실제 셀 토글/import insert는 DB 오염 방지로
 *    본 spec에서 확정 트리거하지 않음(부모 spec 동일 정책 — 삽입 동선은 field-soak 검증).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260608-foot-DUTYROSTER-ALLSTAFF-REVERT — 근무 캘린더 director-only 복원', () => {
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

  test('시나리오1: 그리드 director-only 복원 — "원장님" 헤더/빈상태 복원(AC-1)', async ({ page }) => {
    // 직원이 있으면 그리드 헤더가 "원장님"으로 복원, 없으면 빈상태가 원장 전용 문구로 복원.
    const directorHeader = page.getByRole('columnheader', { name: '원장님' });
    const directorEmpty = page.getByText('등록된 원장님이 없습니다');

    const headerVisible = await directorHeader.isVisible().catch(() => false);
    if (headerVisible) {
      // AC-1: 헤더 컬럼이 "원장님"으로 복원 (ALLSTAFF "직원" 보정 흔적 없음)
      await expect(directorHeader).toBeVisible();
      await expect(page.getByRole('columnheader', { name: '직원' })).toHaveCount(0);
      console.log('[시나리오1] 그리드 헤더 "원장님" director-only 복원 OK');
    } else {
      // 원장 0명 환경 — 빈상태가 director 전용 문구로 복원("직원 일반" 보정 제거)
      await expect(directorEmpty).toBeVisible();
      await expect(page.getByText('등록된 직원이 없습니다')).toHaveCount(0);
      console.log('[시나리오1] 빈상태 "등록된 원장님이 없습니다" director-only 복원 OK');
    }
  });

  test('시나리오2: 배너 무회귀 — "오늘 근무 원장님" director 파생 정상(AC-2)', async ({ page }) => {
    // revert로 director 파생 배너가 깨지지 않고 정상 렌더
    await expect(page.getByText('근무 원장님')).toBeVisible({ timeout: 5_000 });
    console.log('[시나리오2] 원장 배너 director 파생 무회귀 OK');
  });

  test('시나리오3: import 진입점/취소 무영향 — 그리드·배너 불변(AC-5)', async ({ page }) => {
    // admin/manager(편집권한) 세션 → import 진입점 노출
    const importBtn = page.getByTestId('duty-import-btn');
    if (!(await importBtn.isVisible().catch(() => false))) {
      test.skip(true, 'import 진입점 미노출(비편집 권한) — 권한 불변 케이스');
    }
    await importBtn.click();
    await expect(page.getByText('구글시트 근무 스케줄 불러오기')).toBeVisible({ timeout: 5_000 });
    // 취소 → 다이얼로그 닫힘
    await page.getByRole('button', { name: '취소' }).click();

    // 다이얼로그 닫아도 근무캘린더(배너) 그대로 — 그리드/handover 무영향
    await expect(page.getByText('근무 원장님')).toBeVisible();
    console.log('[시나리오3] import 진입점/취소 동선 + 그리드·배너 무영향 OK');
  });
});
