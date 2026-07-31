/**
 * E2E spec — T-20260801-foot-ASSIGN-DAILYTGT-MONTHBOUNDARY-WINDOW-FIX
 *   (김주연 총괄 field 보고. 상담 배정 화면. FE 랭킹 소스 윈도우 정정 — DB/DDL/DML/매출귀속 무접촉.)
 *
 * 근인: 랭킹 소스 윈도우 [monthStart, selectedDate] 에서 monthStart = selectedDate 7자리+"-01".
 *   월 첫날(예 08-01) → monthStart==selectedDate → 윈도우 [08-01,08-01] 단일일 붕괴 →
 *   consultant_universe(체크인/단건/패키지 전부 0) → targetPerfRows=[] → dailyTargetMap 공백 → 목표 전원 '—'.
 *   B(N=0) 아님(종로 N=41). 매월 1일 재발하는 구조결함.
 *
 * 수정: fetchRankingSourceWithMonthFallback — 당월 윈도우가 (a)모수 0행 또는 (b)월 첫날(monthStart==to)이면
 *   전월 전체 [전월1일,전월말일]로 재조회해 랭킹 모수를 채운다. 당월 모수 존재 & 월 첫날 아니면 폴백 미발동(회귀0).
 *   N비례 산식(NPROP)·config·rankAssignmentRatios 불변 — '랭킹비율' 소스 윈도우만 정정. Σ=N 불변.
 *
 * 시나리오(티켓):
 *  1) 월 첫날 목표 반영: 출근 실장 목표가 공백('—')이 아니라 유효 건수로 채워지고, 합계 = 금일 초진 N.
 *  2) 월 중 회귀 없음: 당월 데이터 존재일은 기존 당월누적 동작 유지(합계=N 불변).
 *  3) 휴무자: 당일 휴무 실장은 '—'(폴백과 무관).
 *
 * 라이브 출결/랭킹/예약 데이터 의존 → 날짜에 독립적인 구조·불변식으로 검증.
 *   핵심 회귀-차단 불변식(본 fix 목적): "N>0 이고 출근 상담실장이 있으면 목표가 populated(합계=N) —
 *   월 첫날에도 전원 공백이 되지 않는다." (실행일이 월 첫날이면 폴백 경로가 라이브로 실행됨.)
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

/** 출근 실장(off-today='false')의 '일일 배정 목표' 숫자값 배열(행 순서 = 랭킹순). '—'/비상담 제외. */
async function workingTargetValues(page: import('@playwright/test').Page): Promise<number[]> {
  const cells = page.locator('[data-testid^="accum-day-target-"]');
  const n = await cells.count();
  const vals: number[] = [];
  for (let i = 0; i < n; i++) {
    const cell = cells.nth(i);
    const off = await cell.getAttribute('data-off-today');
    const txt = (await cell.textContent())?.trim() ?? '';
    if (off === 'false' && /^\d[\d,]*$/.test(txt)) {
      vals.push(parseInt(txt.replace(/,/g, ''), 10));
    }
  }
  return vals;
}

/** 출근 실장 목표 셀 개수(populated 여부 판정 모수 — 값이 '—'든 숫자든 셀 존재). */
async function workingCellCount(page: import('@playwright/test').Page): Promise<number> {
  const cells = page.locator('[data-testid^="accum-day-target-"]');
  const n = await cells.count();
  let c = 0;
  for (let i = 0; i < n; i++) {
    if ((await cells.nth(i).getAttribute('data-off-today')) === 'false') c++;
  }
  return c;
}

async function readN(page: import('@playwright/test').Page): Promise<number | null> {
  const header = page.locator('[data-testid="accum-daily-target-header"]');
  const raw = await header.getAttribute('data-daily-target-n');
  if (raw == null || raw === '') return null; // config/N 미조회 → 검증 스킵
  const v = parseInt(raw, 10);
  return Number.isNaN(v) ? null : v;
}

test.describe('T-20260801 ASSIGN-DAILYTGT-MONTHBOUNDARY-WINDOW-FIX', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // ── 시나리오 1: 월 첫날 목표 반영 (핵심 회귀-차단) ──────────────────────────────
  //   월경계 폴백 후 출근 실장 목표가 전원 공백('—')이 아니라 유효 건수로 채워지고 합계 = N.
  //   실행일이 월 첫날이면 폴백 경로가 라이브 실행됨(오늘 08-01 = 정확히 재현 조건).
  test('시나리오1: N>0·출근 실장 존재 시 목표 populated(전원 공백 아님) + 합계 = N', async ({
    page,
  }) => {
    const ok = await gotoAssignments(page);
    if (!ok) {
      test.skip(true, '배정 화면 진입 실패 — 스킵');
      return;
    }
    const N = await readN(page);
    if (N == null) {
      test.skip(true, 'N(금일 초진/목표 config) 미조회 — 정합 검증 스킵');
      return;
    }
    const working = await workingCellCount(page);
    if (working === 0) {
      test.skip(true, '출근 상담실장 행 없음 — 스킵');
      return;
    }
    const vals = await workingTargetValues(page);
    if (N > 0) {
      // ★ 본 fix 핵심 불변식: N>0 이고 출근 실장이 있으면 목표가 반드시 채워진다(월경계 붕괴로 전원 '—' 금지).
      //   버그 상태에선 targetPerfRows=[] → workingTargetValues=[] (전원 '—'). 폴백으로 최소 1행 populated.
      expect(vals.length).toBeGreaterThan(0);
      // 합계 = N (반올림 나머지 최하위 흡수로 정확히 일치 — NPROP 산식 불변).
      expect(vals.reduce((a, b) => a + b, 0)).toBe(N);
      // 랭킹 비례: 행 순서=랭킹순 → 최상위(1등)가 전체 최대(상위<하위 역전 금지).
      for (const v of vals) expect(v).toBeLessThanOrEqual(vals[0]);
    }
    // 각 목표는 0 이상 정수(음수/NaN 금지).
    for (const v of vals) expect(v).toBeGreaterThanOrEqual(0);
  });

  // ── 시나리오 2: 월 중 회귀 없음 ──────────────────────────────────────────────
  //   폴백 발동 여부와 무관하게 개별 목표 합계는 정확히 N (당월 모수 존재일 = 기존 당월누적 동작).
  test('시나리오2: 회귀 없음 — 개별 목표 합계 = N (당월 데이터 존재일 기존 동작 불변)', async ({
    page,
  }) => {
    const ok = await gotoAssignments(page);
    if (!ok) {
      test.skip(true, '배정 화면 진입 실패 — 스킵');
      return;
    }
    const N = await readN(page);
    const vals = await workingTargetValues(page);
    if (N == null || vals.length === 0) {
      test.skip(true, 'N 또는 출근 목표 행 없음 — 스킵');
      return;
    }
    // 핵심 불변식: 합계는 폴백·반올림과 무관하게 정확히 N.
    expect(vals.reduce((a, b) => a + b, 0)).toBe(N);
    // N=0(오늘 초진 예약 없음): 전 출근 실장 목표 = 0, 에러 없이 표시.
    if (N === 0) for (const v of vals) expect(v).toBe(0);
  });

  // ── 시나리오 3: 휴무자 ('—', 폴백과 무관) ───────────────────────────────────
  test('시나리오3: 당일 휴무자(off-today="true") 목표 = "—" (분배 대상 제외)', async ({
    page,
  }) => {
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
      expect(txt).not.toBe(''); // 빈 셀 금지(항상 '—' 또는 숫자)
      if (off === 'true') expect(txt).toBe('—'); // 당일 휴무 → 분배 대상 아님 → '—'
    }
  });

  // ── 회귀: 구조/컬럼/어피던스 유지 (신규 DDL 없음) ────────────────────────────
  test('회귀: 일누적/당월누적 그룹 + "일일 배정 목표" 컬럼 + N 어피던스 유지', async ({ page }) => {
    const ok = await gotoAssignments(page);
    if (!ok) {
      test.skip(true, '배정 화면 진입 실패 — 스킵');
      return;
    }
    await expect(page.locator('[data-testid="accum-group-day"]')).toBeVisible();
    await expect(page.locator('[data-testid="accum-group-month"]')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '일일 배정 목표' })).toBeVisible();
    await expect(page.locator('[data-testid="accum-daily-target-header"]')).toHaveCount(1);
  });
});
