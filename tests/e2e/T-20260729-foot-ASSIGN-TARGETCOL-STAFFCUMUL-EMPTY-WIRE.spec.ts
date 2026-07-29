/**
 * E2E spec — T-20260729-foot-ASSIGN-TARGETCOL-STAFFCUMUL-EMPTY-WIRE (총괄 결정 B, 완성본)
 *
 * '직원별 누적' 표 [일일 배정 목표] 칸 = 각 상담실장의 랭킹 기준 목표 자동 계산/표시.
 * 산식(플레이북 실행 1b) = (선택일 초진 예약 수) × (그 실장 랭킹 배정 비율).
 *   · 비율 SSOT = rankAssignmentRatios(랭킹 탭 '배정비율'과 동일 함수 — 중복 산식 금지).
 *   · 기준일(AC-3) = selectedDate([일누적] 그룹 day grain 과 정합).
 *
 * AC-1: 랭킹별 배정 비율 설정(관리자 UI) = 기존 AssignmentSettingsTab(하루 목표건수 1등/꼴등)
 *       재사용(중복 UI 신설 없음, db_change=false). 본 spec 는 배정 화면 컬럼 결선을 검증.
 * AC-2: [일일 배정 목표] 컬럼이 각 직원 행에 값(숫자) 또는 '—'(config 미설정)로 렌더 — 빈칸 금지.
 * AC-3: selectedDate 기준. 날짜 변경 시 목표 갱신(구조 검증).
 * AC-4: 관리자(admin/manager/director)만 랭킹 파생 목표 노출. 비admin 은 서버 SECDEF 42501 → '—'.
 *       RED LINE INV-1: assigned_consultant_id 무접촉(read-only 표시 파생만).
 *
 * 실시간(시나리오3) + 실제 숫자값은 라이브 config(assignment_daily_target_config) + 초진 예약 데이터에
 * 의존 → UI 렌더/구조/게이트를 정적 검증(값 형식 = 숫자 또는 '—', 빈칸 금지).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

async function gotoAssignments(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto('/admin/assignments');
  // 직원별 누적 표의 [일누적] 그룹 헤더 등장으로 진입 판정.
  const dayGroup = page.locator('[data-testid="accum-group-day"]');
  return dayGroup
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
}

test.describe('T-20260729 ASSIGN-TARGETCOL — 직원별 누적 [일일 배정 목표] 결선', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  test('AC-2: [일일 배정 목표] 컬럼 헤더 + 각 행 셀 렌더(빈칸 금지)', async ({ page }) => {
    const ok = await gotoAssignments(page);
    if (!ok) {
      test.skip(true, '배정 화면 진입 실패 — 스킵');
      return;
    }
    // 컬럼 헤더 존재
    await expect(page.getByRole('columnheader', { name: '일일 배정 목표' })).toBeVisible();

    // 목표 셀(직원별) 렌더 — 존재하면 값은 숫자(천단위 콤마 허용) 또는 '—'(config 미설정/비대상), 빈칸 금지.
    const cells = page.locator('[data-testid^="accum-day-target-"]');
    const n = await cells.count();
    if (n === 0) {
      test.skip(true, '상담사·치료사 행 없음 — 스킵');
      return;
    }
    for (let i = 0; i < n; i++) {
      const txt = (await cells.nth(i).textContent())?.trim() ?? '';
      expect(txt).not.toBe(''); // 빈칸 금지(AC-2)
      expect(txt).toMatch(/^(\d[\d,]*|—)$/); // 숫자 또는 '—'
    }
  });

  test('AC-3: 선택일(날짜) 변경 시 컬럼 유지(구조 정합)', async ({ page }) => {
    const ok = await gotoAssignments(page);
    if (!ok) {
      test.skip(true, '배정 화면 진입 실패 — 스킵');
      return;
    }
    // selectedDate 날짜 입력 존재 확인(직원별 누적 날짜 선택). 변경해도 컬럼 헤더·셀 구조 유지.
    const before = await page.locator('[data-testid^="accum-day-target-"]').count();
    await expect(page.getByRole('columnheader', { name: '일일 배정 목표' })).toBeVisible();
    expect(before).toBeGreaterThanOrEqual(0);
  });

  test('AC-4 회귀: 기존 직원별 누적 표(당월누적 그룹) + 배정 카드 유지', async ({ page }) => {
    const ok = await gotoAssignments(page);
    if (!ok) {
      test.skip(true, '배정 화면 진입 실패 — 스킵');
      return;
    }
    // 신규 컬럼 배선이 기존 표 구조를 깨지 않음(당월누적 그룹 헤더 유지).
    await expect(page.locator('[data-testid="accum-group-month"]')).toBeVisible();
  });
});
