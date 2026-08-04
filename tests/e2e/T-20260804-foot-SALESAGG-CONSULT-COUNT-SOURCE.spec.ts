/**
 * T-20260804-foot-SALESAGG-CONSULT-COUNT-SOURCE (案1)
 * 매출집계 탭4(담당실장별) — 첫 컬럼 '오더 건수' → '상담 건 수' 라벨·소스 변경 E2E
 *
 * 현장 확정 스펙(김주연 총괄 2026-08-04, 案1 = 담당실장 grain):
 *   - '상담 건 수' = assigned_staff_id별 + check_ins.consultation_done=true 방문 수.
 *     = 담당실장이 맡은 고객 중 실제 상담이 완료된 방문 수(담당실장 grain).
 *   - 案2(consultant_id 수행자 grain)·案3(ticketing_count=구 '오더 건수' payments row 카운트) 폐기.
 *   - 다른 3칸(패키지·급여·공단)과 grain 일치(assigned_staff_id) → 별도 오독방지 UI 불요.
 *
 * 현장 클릭 시나리오(티켓 §현장 클릭 시나리오) → E2E 변환:
 *   시나리오 1: 첫 컬럼 헤더 '상담 건 수' 표시(구 '오더 건 수'/'오더 건수' 미표시).
 *              첫 컬럼 위치(담당실장 바로 다음) 유지 + 정수 카운트 렌더.
 *   시나리오 2: 담당실장≠상담수행자여도 assigned_staff_id 위치로 일관 카운트(코드레벨 보장) —
 *              E2E는 카운트 셀 testid(정수) 구조·합계 정합으로 구조적 검증.
 *
 * 빈 데이터(staging DB)에서는 empty state / 컬럼 헤더·구조 검증으로 대체.
 * ※ 案1 grain(assigned_staff_id + consultation_done=true)은 코드레벨로 보장 —
 *    E2E는 라벨 치환·컬럼구조·정수 카운트·합계 정합으로 회귀를 검증한다(READ-ONLY, db_change=false).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const SALES_URL = '/admin/sales';
const TAB_NAME = '담당실장별';

async function gotoDoctorTab(page: import('@playwright/test').Page) {
  await page.goto(SALES_URL);
  await expect(page.getByRole('heading', { name: '매출집계' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('tab', { name: TAB_NAME }).click();
  await expect(page.locator('[data-testid="sales-doctor-loading"]')).toHaveCount(0, {
    timeout: 25_000,
  });
  await expect(
    page.locator('[data-testid="sales-doctor-tab"], [data-testid="sales-doctor-empty"]'),
  ).toBeVisible({ timeout: 10_000 });
}

async function hasTable(page: import('@playwright/test').Page) {
  return page
    .locator('[data-testid="sales-doctor-tab"]')
    .isVisible({ timeout: 5_000 })
    .catch(() => false);
}

test.describe('T-20260804-foot-SALESAGG-CONSULT-COUNT-SOURCE 상담 건 수(案1)', () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded — auth 실패');
  });

  // ── 시나리오 1: 첫 컬럼 헤더 '상담 건 수' 표시, 구 '오더 건 수' 미표시 ─────────────
  test('시나리오1: 첫 컬럼 헤더가 "상담 건 수"로 표시(구 "오더 건수" 미표시)', async ({ page }) => {
    await gotoDoctorTab(page);

    if (!(await hasTable(page))) {
      console.log('[CONSULT-COUNT] empty state — 헤더 검증 skip');
      await expect(page.locator('[data-testid="sales-doctor-empty"]')).toBeVisible();
      return;
    }

    const tableEl = page.locator('[data-testid="sales-doctor-tab"]');
    const headers = tableEl.getByRole('columnheader');

    // 신규 라벨 노출
    await expect(tableEl.getByRole('columnheader', { name: '상담 건 수' })).toBeVisible();
    // 구 라벨 완전 제거
    await expect(tableEl.getByRole('columnheader', { name: '오더 건수' })).toHaveCount(0);
    await expect(tableEl.getByRole('columnheader', { name: '오더 건 수' })).toHaveCount(0);

    // 첫 컬럼 = '담당실장', 두 번째 컬럼 = '상담 건 수' (위치 유지)
    await expect(headers.nth(0)).toHaveText('담당실장');
    await expect(headers.nth(1)).toHaveText('상담 건 수');
    console.log('[CONSULT-COUNT] 시나리오1 라벨 치환 + 위치 OK');
  });

  // ── 시나리오 2: 상담 건 수 셀 = 정수 카운트 + 합계 정합(assigned_staff_id 일관) ──────
  test('시나리오2: 상담 건 수 셀이 정수 카운트로 렌더 + 합계 = 행 합', async ({ page }) => {
    await gotoDoctorTab(page);

    if (!(await hasTable(page))) {
      console.log('[CONSULT-COUNT] empty state — 카운트 셀 검증 skip');
      return;
    }

    // 합계 행 상담 건 수 셀 존재 + 정수
    const totalCell = page.locator('[data-testid="sales-doctor-total-consultcount"]');
    await expect(totalCell).toBeVisible();
    const totalText = ((await totalCell.textContent()) ?? '').trim();
    expect(totalText).toMatch(/^\d+$/); // 정수(원/콤마 없음 — 건수)

    // 행별 상담 건 수 셀 합 == 합계 셀 (assigned_staff_id grain 일관 카운트 정합)
    const rowCells = page.locator('[data-testid^="sales-doctor-consultcount-"]');
    const n = await rowCells.count();
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const t = ((await rowCells.nth(i).textContent()) ?? '').trim();
      expect(t).toMatch(/^\d+$/);
      sum += Number(t);
    }
    expect(sum).toBe(Number(totalText));
    console.log(`[CONSULT-COUNT] 시나리오2 상담 건 수 정합 OK (rows=${n}, total=${totalText})`);
  });
});
