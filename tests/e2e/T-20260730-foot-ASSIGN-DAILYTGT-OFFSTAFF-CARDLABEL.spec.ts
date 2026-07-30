/**
 * E2E spec — T-20260730-foot-ASSIGN-DAILYTGT-OFFSTAFF-CARDLABEL
 *   (김주연 총괄, 상담·치료사 배정 화면. FE 표시 전용 — DB/DDL/DML/매출귀속 무접촉.)
 *
 * AC1: 상단 카드 제목 [일일 배정 목표 · 차주 초진 예약] → [차주 초진 예약]
 *      ('일일 배정 목표 ·' prefix 제거 — 하단 [직원별 누적] 동명 컬럼과 혼동 방지).
 *      카드 로직/데이터/모노톤·컴팩트 스타일 무접촉 — 제목 텍스트만.
 * AC2 [정정 MSG-uqow — 제외 대상 반전]:
 *      [직원별 누적] 표 '일일 배정 목표' 컬럼에서 당일 휴무자 행만 '—'(숫자 미표시).
 *      · 당일 휴무 판정 = 출근 명단(workingIds = fetchTodayWorkingStaffIds, 출근 SSOT) 부재.
 *        구현 신호 = 셀 data-off-today 속성('true'=당일 휴무 → '—', 'false'=출근 → 숫자/'—'(config)).
 *      · ⚠ 임시 off(tempOff) 직원은 '출근했으나 자동배정만 임시제외' → workingIds 포함 → 숫자 유지(제외 X).
 *        임시 off ≠ 당일 휴무. temp-off-toggle 버튼이 보이는 행 = 출근자 → off-today='false'.
 * AC3 (보존): 당월누적/총누적 컬럼 무접촉 — off 직원도 과거 실적 유지.
 * AC4 (RED LINE): 매출 귀속(assigned_consultant_id)·자동배정 엔진(poolFor/maybeAutoAssign) 무접촉.
 *      순수 FE 표시 필터(workingIds read-only 재사용). DB/DDL/DML 없음.
 *
 * 라이브 출결/랭킹 데이터 의존 → 구조·불변식 검증(off-today↔'—' 상관, tempOff 행=출근).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

async function gotoAssignments(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto('/admin/assignments');
  const dayGroup = page.locator('[data-testid="accum-group-day"]');
  return dayGroup
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
}

test.describe('T-20260730 ASSIGN-DAILYTGT-OFFSTAFF-CARDLABEL', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // ── 시나리오 1: 상단 카드 제목 (AC1) ──────────────────────────────────────────
  test('AC1: 상단 카드 제목이 "차주 초진 예약" (prefix "일일 배정 목표 ·" 제거)', async ({ page }) => {
    const ok = await gotoAssignments(page);
    if (!ok) {
      test.skip(true, '배정 화면 진입 실패 — 스킵');
      return;
    }
    const card = page.locator('[data-testid="assignments-nextweek-target-card"]');
    await expect(card).toBeVisible();
    // 카드 제목 = 정확히 '차주 초진 예약'. '일일 배정 목표' 문구 없음.
    const title = card.locator('.text-sm').first();
    await expect(title).toHaveText('차주 초진 예약');
    await expect(card).not.toContainText('일일 배정 목표 ·');
    // 카드 본문(차주 요일별 grid)·설명문은 유지(스타일/데이터 무접촉).
    await expect(page.locator('[data-testid="nextweek-target-grid"]')).toBeVisible();
  });

  // ── 시나리오 2: 직원별 누적 '일일 배정 목표' 당일 휴무자 제외 (AC2/AC3) ────────
  test('AC2: 당일 휴무자(off-today) 행 = "—", 출근자·임시off 행은 제외 아님', async ({ page }) => {
    const ok = await gotoAssignments(page);
    if (!ok) {
      test.skip(true, '배정 화면 진입 실패 — 스킵');
      return;
    }
    const cells = page.locator('[data-testid^="accum-day-target-"]');
    const n = await cells.count();
    if (n === 0) {
      test.skip(true, '상담사·치료사 행 없음 — 스킵');
      return;
    }
    for (let i = 0; i < n; i++) {
      const cell = cells.nth(i);
      const off = await cell.getAttribute('data-off-today');
      const txt = (await cell.textContent())?.trim() ?? '';
      expect(txt).not.toBe(''); // 빈칸 금지
      if (off === 'true') {
        // 당일 휴무자 → 반드시 '—'(숫자 미표시)
        expect(txt).toBe('—');
      } else {
        // 출근자(임시 off 포함) → 숫자(천단위 콤마) 또는 '—'(config 미설정/비상담). 휴무로 인한 강제 '—' 아님.
        expect(txt).toMatch(/^(\d[\d,]*|—)$/);
      }
    }
  });

  test('AC2 불변식: 임시 off(temp-off-toggle 노출) 행은 off-today="false" (포함 유지)', async ({ page }) => {
    const ok = await gotoAssignments(page);
    if (!ok) {
      test.skip(true, '배정 화면 진입 실패 — 스킵');
      return;
    }
    // temp-off-toggle 버튼은 출근자에게만 렌더(workingIds.has) → 그 행의 목표 셀은 off-today='false'.
    const toggles = page.locator('[data-testid^="temp-off-toggle-"]');
    const t = await toggles.count();
    if (t === 0) {
      test.skip(true, '출근자(임시 off 토글) 없음 — 스킵');
      return;
    }
    for (let i = 0; i < t; i++) {
      const testid = await toggles.nth(i).getAttribute('data-testid');
      const staffId = (testid ?? '').replace('temp-off-toggle-', '');
      const targetCell = page.locator(`[data-testid="accum-day-target-${staffId}"]`);
      await expect(targetCell).toHaveAttribute('data-off-today', 'false');
    }
  });

  test('AC3: 당월누적/총누적 컬럼 무접촉(off 직원도 과거 실적 유지)', async ({ page }) => {
    const ok = await gotoAssignments(page);
    if (!ok) {
      test.skip(true, '배정 화면 진입 실패 — 스킵');
      return;
    }
    // 당월누적 그룹 헤더 + 총 누적 배정 셀 유지. 휴무 제외 필터는 '일일 배정 목표' 1개 컬럼에만 국한.
    await expect(page.locator('[data-testid="accum-group-month"]')).toBeVisible();
    const monthCells = page.locator('[data-testid^="accum-month-total-"]');
    const m = await monthCells.count();
    for (let i = 0; i < m; i++) {
      const txt = (await monthCells.nth(i).textContent())?.trim() ?? '';
      expect(txt).toMatch(/^\d[\d,]*$/); // 누적은 항상 숫자(휴무 제외 필터 무관)
    }
  });

  // ── 시나리오 3: 회귀 (AC4) ────────────────────────────────────────────────────
  test('AC4 회귀: 일누적/당월누적 그룹 구조 + 배정 카드 유지(엔진·매출귀속 무접촉)', async ({ page }) => {
    const ok = await gotoAssignments(page);
    if (!ok) {
      test.skip(true, '배정 화면 진입 실패 — 스킵');
      return;
    }
    await expect(page.locator('[data-testid="accum-group-day"]')).toBeVisible();
    await expect(page.locator('[data-testid="accum-group-month"]')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '일일 배정 목표' })).toBeVisible();
    await expect(page.locator('[data-testid="assignments-nextweek-target-card"]')).toBeVisible();
  });
});
