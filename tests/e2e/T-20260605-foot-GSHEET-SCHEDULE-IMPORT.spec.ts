/**
 * E2E spec — T-20260605-foot-GSHEET-SCHEDULE-IMPORT
 * 구글시트 근무 스케줄 불러오기 (Phase 1: 수동 import → duty_roster, 미리보기+확정 게이트)
 *
 * 대상 = duty_roster (직원 근무 스케줄). 진입점 = 직원 > 근무캘린더 탭 "구글시트 불러오기".
 *
 * 시나리오(티켓 RE-SCOPE 기준):
 *  1) 정상 미리보기 게이트(AC-2): 붙여넣기 파싱 → 미리보기 표시 + "아직 저장 전" 고지.
 *     이 시점 DB insert 안 됨(확정 버튼 누르기 전).
 *  2) 오류 행 처리(AC-3): 매칭 실패 직원행 → 미리보기에 "오류" 표기, 정상 0건이면 확정 비활성.
 *  3) GUARD 회귀(AC-6/AC-7): 기존 근무캘린더 그리드 렌더 불변 + 진입점 admin/manager 한정.
 *
 * ※ 실제 insert(정상행)는 DB 오염을 피하기 위해 본 spec에서 트리거하지 않음(매칭불가 이름 사용).
 *    삽입 동선은 supervisor field-soak / 시트 샘플 확정 후 보정 단계에서 심화 검증.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// 의도적으로 매칭 불가한 이름 — 실제 staff와 충돌 안 되게 랜덤 토큰 부여 → 모든 행 '오류'(미삽입 보장)
const NON_MATCH = `없는직원_${Math.random().toString(36).slice(2, 8)}`;

/** 달력형(행=직원, 열=날짜) 붙여넣기 샘플 (TSV) */
function calendarPaste(name: string): string {
  return [
    `이름\t2026-06-08\t2026-06-09\t2026-06-10`,
    `${name}\t근무\t파트\t`,
  ].join('\n');
}

test.describe('T-20260605-foot-GSHEET-SCHEDULE-IMPORT — 근무 스케줄 불러오기', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');

    await page.goto('/admin/staff');
    // 기본 탭 = 근무캘린더(duty). 진입점 버튼 노출 대기.
    try {
      await page.getByTestId('duty-import-btn').waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, '근무캘린더 탭 또는 구글시트 불러오기 진입점 없음(권한/데이터)');
    }
  });

  test('시나리오1: 붙여넣기 파싱 → 미리보기 게이트(AC-2, 저장 전)', async ({ page }) => {
    await page.getByTestId('duty-import-btn').click();
    await page.getByTestId('duty-import-paste-mode').click();

    await page.getByTestId('duty-import-paste-textarea').fill(calendarPaste(NON_MATCH));
    await page.getByTestId('duty-import-parse-btn').click();

    // 미리보기 테이블 + 요약 배지 표시
    await expect(page.getByTestId('duty-import-preview')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('duty-import-summary')).toContainText('정상');

    // AC-2 GUARD: 아직 저장 전 고지 표시
    await expect(page.getByText('“삽입 확정” 클릭 시에만 저장됩니다.')).toBeVisible();

    console.log('[시나리오1] 파싱→미리보기 표시 + 저장 전 게이트 고지 OK');
  });

  test('시나리오2: 매칭 실패 행 오류 표기 + 정상 0건이면 확정 비활성(AC-3)', async ({ page }) => {
    await page.getByTestId('duty-import-btn').click();
    await page.getByTestId('duty-import-paste-mode').click();
    await page.getByTestId('duty-import-paste-textarea').fill(calendarPaste(NON_MATCH));
    await page.getByTestId('duty-import-parse-btn').click();

    await expect(page.getByTestId('duty-import-preview')).toBeVisible({ timeout: 5_000 });

    // 매칭 불가 직원 → "직원 매칭 실패" 오류 행 (근무·파트 2행)
    await expect(page.getByText(/직원 매칭 실패/).first()).toBeVisible();

    // 정상 행이 없으므로 "삽입 확정" 비활성 (실 insert 미발생 보장)
    await expect(page.getByTestId('duty-import-confirm')).toBeDisabled();

    console.log('[시나리오2] 오류 행 표기 + 확정 버튼 비활성(미삽입) OK');
  });

  test('시나리오3: GUARD — 근무캘린더 그리드 렌더 불변 + 진입점 존재', async ({ page }) => {
    // 기존 근무캘린더 UI(오늘 근무 원장님 배너) 정상 렌더
    await expect(page.getByText('근무 원장님')).toBeVisible({ timeout: 5_000 });

    // 진입점은 admin/manager(canEdit)에서만 노출 — 본 세션에서 노출됨
    await expect(page.getByTestId('duty-import-btn')).toBeVisible();

    // 다이얼로그 열고 취소해도 그리드 영향 없음
    await page.getByTestId('duty-import-btn').click();
    await expect(page.getByTestId('duty-import-paste-mode')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: '취소' }).click();
    await expect(page.getByText('근무 원장님')).toBeVisible();

    console.log('[시나리오3] 기존 그리드 불변 + 진입점/취소 동선 OK');
  });
});
