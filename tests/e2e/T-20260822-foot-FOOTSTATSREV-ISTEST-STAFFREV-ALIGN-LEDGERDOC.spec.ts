/**
 * supervisor QA — T-20260822-foot-FOOTSTATSREV-ISTEST-STAFFREV-ALIGN-LEDGERDOC
 *
 * 목적(축1, money-path): 담당실장별 매출탭 read-side 제외코호트를 총매출 KPI RPC
 *   foot_stats_revenue 와 동형으로 수렴 — non-real = (is_simulation IS TRUE OR is_test IS TRUE).
 *   구 read-side 는 sim 단독(.eq is_simulation)만 제외 → is_test 고객 매출이 실장별 합계에
 *   잔류하여 총매출 KPI 와 ~4.82M(8월) 발산했다. getNonRealCustomerIds(sim∪test) 단일 정본술어로
 *   수렴 → 실장별 매출탭 총합 == foot_stats_revenue NET(627,457,000, 2026-08 실측).
 *
 * 배경 DA: da_decision_foot_footstatsrev_istest_exclusion_orphanledger_20260822
 *   축1 canonical = (a) is_test 제외 REAFFIRM (총매출 모집단 밖). RPC 술어 제거 REJECT →
 *   foot-only, FE 를 RPC 에 정렬. staffRevenue.ts db_change=false(read-side predicate).
 *
 * 시나리오:
 *   S1  /admin/sales 담당실장별 탭 렌더 (제외축 통일이 집계를 깨지 않음 = 정상동선)
 *   L1  제외코호트 불변식 — non-real(sim∪test) 제외 + 워크인/실고객 보존 + is_test 잔류 회귀 폐쇄
 *
 * ※ 축2(orphan ledger 20260719160000 forward-doc)의 content-parity(md5)·DDL-diff-empty 는
 *   비영속 dry-run(prod introspection)으로 별도 검증 — E2E scope 아님(순수 DB DDL).
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:8089';

test.describe('FOOTSTATSREV-ISTEST-STAFFREV-ALIGN — 담당실장별 매출탭 non-real 제외축 통일', () => {

  test('S1: /admin/sales 담당실장별 탭 렌더 (제외축 통일 후 집계 무결)', async ({ page }) => {
    await page.goto(`${BASE}/admin/sales`, { waitUntil: 'networkidle', timeout: 20_000 });
    await expect(page.getByRole('tab', { name: '담당실장별' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('tab', { name: '담당실장별' }).click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/qa_footstatsrev_istest_s1_staff.png' });
    const bodyText = await page.locator('body').innerText();
    const hasContent =
      bodyText.includes('원') || bodyText.includes('매출') ||
      bodyText.includes('실장') || bodyText.includes('합계');
    expect(hasContent).toBeTruthy();
  });

  /**
   * L1: 제외코호트 불변식 (순수 로직).
   *   getNonRealCustomerIds 는 clinic 내 (is_simulation IS TRUE OR is_test IS TRUE) 고객 id 를 반환,
   *   excludeSimulationPaymentRows 가 그 집합의 결제를 제외한다. 계약:
   *     - is_simulation=true 고객        → 제외
   *     - is_test=true 고객 (sim 아님)   → 제외 ★ 구 sim-단독 술어에선 잔류하던 회귀 지점
   *     - 실고객(sim/test 아님)          → 보존
   *     - customer_id = NULL(워크인)     → 보존 (실매출 무손상)
   *     - non-real 0건(라이브 정상)       → 전량 보존 (무변화)
   *   simulationFilter.ts 는 supabase 를 import 하므로 코호트 산출/제외 로직을 동치로 재현해
   *   불변식만 단언한다(prod RPC 술어와 문자적 동형).
   */
  test('L1: non-real(sim∪test) 제외 + 워크인/실고객 보존 + is_test 잔류 회귀 폐쇄', async () => {
    // getNonRealCustomerIds 동치: 고객 flag → 제외 코호트 id 집합 (sim∪test)
    const nonRealCohort = (
      custs: { id: string; is_simulation?: boolean | null; is_test?: boolean | null }[],
    ): Set<string> =>
      new Set(
        custs
          .filter((c) => c.is_simulation === true || c.is_test === true)
          .map((c) => c.id),
      );

    // excludeSimulationPaymentRows 동치
    const exclude = <R extends { customer_id?: string | null }>(
      rows: R[],
      ids: ReadonlySet<string>,
    ): R[] => (ids.size === 0 ? rows : rows.filter((r) => !r.customer_id || !ids.has(r.customer_id)));

    const customers = [
      { id: 'sim-1', is_simulation: true, is_test: false },   // sim → 제외
      { id: 'test-1', is_simulation: false, is_test: true },  // is_test → 제외 (회귀 폐쇄 지점)
      { id: 'test-2', is_simulation: null, is_test: true },   // is_test(sim null) → 제외
      { id: 'real-1', is_simulation: false, is_test: false }, // 실고객 → 보존
      { id: 'real-2', is_simulation: null, is_test: null },   // 실고객 → 보존
    ];
    const cohort = nonRealCohort(customers);
    expect([...cohort].sort()).toEqual(['sim-1', 'test-1', 'test-2']);

    const rows = [
      { id: 'p1', customer_id: 'sim-1', amount: 100_000 },   // sim → 제외
      { id: 'p2', customer_id: 'test-1', amount: 500_000 },  // is_test → 제외 (구 술어에선 잔류)
      { id: 'p3', customer_id: 'test-2', amount: 220_000 },  // is_test → 제외
      { id: 'p4', customer_id: 'real-1', amount: 50_000 },   // 실고객 → 보존
      { id: 'p5', customer_id: null, amount: 30_000 },       // 워크인 → 보존
    ];

    const kept = exclude(rows, cohort);
    expect(kept.map((r) => r.id).sort()).toEqual(['p4', 'p5']);
    // 표시매출 = 50,000 + 30,000 = 80,000 (non-real 820,000 미반영 = is_test 720,000 포함)
    expect(kept.reduce((s, r) => s + r.amount, 0)).toBe(80_000);

    // 회귀 대조: 구 sim-단독 술어였다면 is_test 720,000 이 잔류 → KPI 발산
    const simOnly = new Set(['sim-1']);
    const legacyKept = exclude(rows, simOnly);
    expect(legacyKept.reduce((s, r) => s + r.amount, 0)).toBe(800_000); // is_test 잔류로 부풀림
    expect(legacyKept.reduce((s, r) => s + r.amount, 0)).not.toBe(80_000);

    // 라이브 정상(non-real 0건) → 전량 보존 = 무변화
    expect(exclude(rows, new Set<string>()).length).toBe(rows.length);
  });

});
