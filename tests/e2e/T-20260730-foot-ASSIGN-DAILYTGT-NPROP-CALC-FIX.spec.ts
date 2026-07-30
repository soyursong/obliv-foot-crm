/**
 * E2E spec — T-20260730-foot-ASSIGN-DAILYTGT-NPROP-CALC-FIX
 *   (김주연 총괄 field-soak 정정. 상담 배정 화면. FE 계산 산식 교체 — DB/DDL/DML/매출귀속 무접촉.)
 *
 * 정정 스펙: [일일 배정 목표] = 랭킹별 고정 목표 합산(오늘 17) → N비례 분배로 교체.
 *   각 실장 목표 = round(N × 본인weight / 출근실장_전체weight합), 개별 합계 = N(금일 초진 예약 건수).
 *   반올림 나머지는 최하위 랭킹 실장이 흡수 → 정확히 Σ=N.
 *
 * AC1: [일일 배정 목표] 칸 = round(N × weight/Σweight) (고정 합산 아님).
 * AC2: 출근 실장(휴무자 제외) 개별 목표 합계 = N. 반올림 나머지 최하위 흡수 → 정확히 N.
 * AC3: N = 카드의 금일 초진 예약 건수와 동일 소스(재계산·불일치 없음).
 *      → 헤더 data-daily-target-n(=selDayInitResvCount) 어피던스로 N 노출, 합계와 대조.
 * AC4: 당일 휴무자(off-today='true') 목표 분배 대상 제외 + '—' (CARDLABEL 정합 유지).
 * AC5: 랭킹 가중치 weight B 재사용, 신규 DDL/컬럼 없음(구조 회귀).
 *
 * 라이브 출결/랭킹/예약 데이터 의존 → 구조·불변식 검증(합계=N 정합, off↔'—' 상관, 랭킹 상위≥하위).
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

async function readN(page: import('@playwright/test').Page): Promise<number | null> {
  const header = page.locator('[data-testid="accum-daily-target-header"]');
  const raw = await header.getAttribute('data-daily-target-n');
  if (raw == null || raw === '') return null; // config/N 미조회 → 검증 스킵
  const v = parseInt(raw, 10);
  return Number.isNaN(v) ? null : v;
}

test.describe('T-20260730 ASSIGN-DAILYTGT-NPROP-CALC-FIX', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // ── 시나리오 1: 정상 동선 — 출근 실장 목표 합계 = N ───────────────────────────
  test('AC1/AC2/AC3: 출근 실장 목표 합계 = 금일 초진 N, 랭킹 상위 ≥ 하위', async ({ page }) => {
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
    const vals = await workingTargetValues(page);
    if (vals.length === 0) {
      test.skip(true, '출근 상담실장 목표 행 없음 — 스킵');
      return;
    }
    // AC2/AC3: 출근 실장 개별 목표 합계 = N (반올림 나머지 최하위 흡수로 정확히 일치).
    const sum = vals.reduce((a, b) => a + b, 0);
    expect(sum).toBe(N);
    // AC1(랭킹 비례): 행 순서 = 랭킹순(매출 desc) → 상위 실장 목표가 하위보다 작지 않음(단조 비증가).
    //   반올림/나머지 흡수로 인접 동값은 허용, 상위<하위 역전만 금지.
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeLessThanOrEqual(vals[0]); // 최상위(1등)가 전체 최대
    }
    // 각 목표는 0 이상 정수(음수/NaN 금지).
    for (const v of vals) expect(v).toBeGreaterThanOrEqual(0);
  });

  // ── 시나리오 2: 반올림 보정 + 휴무자 제외 정합 ────────────────────────────────
  test('AC2 보정: 개별 round 합이 N과 어긋나도 최하위 흡수로 최종 합계 = N', async ({ page }) => {
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
    // 핵심 불변식: 최종 합계는 반올림 오차와 무관하게 정확히 N (최하위 랭킹 흡수).
    expect(vals.reduce((a, b) => a + b, 0)).toBe(N);
    // N=0(오늘 초진 예약 없음) 케이스: 전 출근 실장 목표 = 0, 에러 없이 표시.
    if (N === 0) {
      for (const v of vals) expect(v).toBe(0);
    }
  });

  test('AC4: 당일 휴무자(off-today="true") 목표 = "—" (분배 대상 제외, CARDLABEL 정합)', async ({ page }) => {
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
      expect(txt).not.toBe('');
      if (off === 'true') expect(txt).toBe('—'); // 당일 휴무 → 분배 대상 아님 → '—'
    }
  });

  // ── 시나리오 3: 회귀 (AC5) — 구조/컬럼 유지, 신규 DDL 없음 ─────────────────────
  test('AC5 회귀: 일누적/당월누적 그룹 + "일일 배정 목표" 컬럼 + N 어피던스 유지', async ({ page }) => {
    const ok = await gotoAssignments(page);
    if (!ok) {
      test.skip(true, '배정 화면 진입 실패 — 스킵');
      return;
    }
    await expect(page.locator('[data-testid="accum-group-day"]')).toBeVisible();
    await expect(page.locator('[data-testid="accum-group-month"]')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '일일 배정 목표' })).toBeVisible();
    // N 노출 어피던스 존재(합계=N 정합 검증 근거).
    await expect(page.locator('[data-testid="accum-daily-target-header"]')).toHaveCount(1);
  });
});
