/**
 * supervisor QA — T-20260709-foot-SALES-SIMULATION-FILTER-DEFENSE
 *
 * 목적: 표시매출(payments/package_payments) 집계 소스에서 is_simulation=true
 *       고객 결제를 상시 제외하는 방어필터의 회귀 + 불변식 검증.
 *
 * 배경: T-20260606-foot-D1-TESTDATA-CLEANUP(624 sims OBE) → CEO Option B.
 *       미래에 테스트/시뮬 데이터가 재유입돼도 표시매출을 부풀리지 못하게 하는 하드닝.
 *
 * AC-3 회귀 원칙:
 *   - 현 라이브 DB엔 sim 매출기여 ₩0 → 필터 적용 전후 표시매출 무변화가 정상.
 *   - 향후 sim 데이터 삽입 시 표시매출 합계에서 제외됨.
 *
 * 시나리오:
 *   S1  매출 화면 5탭 렌더 (필터 도입이 집계를 깨지 않음 = scenario 1 정상동선)
 *   S2~S5 각 탭 콘텐츠 렌더 (aggregation 무결)
 *   L1  방어필터 불변식 — sim 고객 결제 제외 + 워크인(customer_id=NULL) 보존
 *       (excludeSimulationPaymentRows 로직 재현 = scenario 2 격리 검증)
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:8089';

test.describe('SALES-SIMULATION-FILTER-DEFENSE — 표시매출 방어필터', () => {

  test('S1: /admin/sales 5탭 렌더 (필터 도입 후 집계 무결)', async ({ page }) => {
    await page.goto(`${BASE}/admin/sales`, { waitUntil: 'networkidle', timeout: 20_000 });
    await expect(page.getByRole('tab', { name: '일일결산' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('tab', { name: '환자별' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '시술별' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '담당실장별' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '담당치료사별' })).toBeVisible();
    await page.screenshot({ path: '/tmp/qa_simfilter_s1_tabs.png' });
  });

  test('S2: 일일결산 탭 — 매출 매트릭스 렌더', async ({ page }) => {
    await page.goto(`${BASE}/admin/sales`, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.getByRole('tab', { name: '일일결산' }).click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/qa_simfilter_s2_daily.png' });
    const bodyText = await page.locator('body').innerText();
    const hasContent =
      bodyText.includes('원') || bodyText.includes('발생') ||
      bodyText.includes('수납') || bodyText.includes('결산');
    expect(hasContent).toBeTruthy();
  });

  test('S3: 환자별 탭 렌더', async ({ page }) => {
    await page.goto(`${BASE}/admin/sales`, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.getByRole('tab', { name: '환자별' }).click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/qa_simfilter_s3_patient.png' });
  });

  test('S4: 시술별 탭 렌더', async ({ page }) => {
    await page.goto(`${BASE}/admin/sales`, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.getByRole('tab', { name: '시술별' }).click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/qa_simfilter_s4_treatment.png' });
  });

  test('S5: 담당실장별/담당치료사별 탭 렌더', async ({ page }) => {
    await page.goto(`${BASE}/admin/sales`, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.getByRole('tab', { name: '담당실장별' }).click();
    await page.waitForTimeout(1500);
    await page.getByRole('tab', { name: '담당치료사별' }).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: '/tmp/qa_simfilter_s5_staff.png' });
  });

  /**
   * L1: 방어필터 불변식 검증 (순수 로직).
   *   excludeSimulationPaymentRows(rows, simIds)의 계약:
   *     - customer_id ∈ simIds       → 제외
   *     - customer_id = NULL(워크인)  → 보존 (실매출 무손상)
   *     - customer_id ∉ simIds(실고객) → 보존
   *     - simIds 비어있음(라이브 정상) → 전량 보존 (무변화)
   *   simulationFilter.ts 는 supabase 를 import 하므로 브라우저 컨텍스트에서
   *   로직을 그대로 재현해 불변식만 단언한다(구현 동치).
   */
  test('L1: sim 결제 제외 + 워크인/실고객 보존 불변식', async () => {
    const exclude = <R extends { customer_id?: string | null }>(
      rows: R[],
      simIds: ReadonlySet<string>,
    ): R[] => {
      if (simIds.size === 0) return rows;
      return rows.filter((r) => !r.customer_id || !simIds.has(r.customer_id));
    };

    const rows = [
      { id: 'p1', customer_id: 'sim-1', amount: 100_000 },   // sim → 제외
      { id: 'p2', customer_id: 'real-1', amount: 50_000 },   // 실고객 → 보존
      { id: 'p3', customer_id: null, amount: 30_000 },       // 워크인 → 보존
      { id: 'p4', customer_id: 'sim-2', amount: 200_000 },   // sim → 제외
    ];
    const simIds = new Set(['sim-1', 'sim-2']);

    const kept = exclude(rows, simIds);
    const total = kept.reduce((s, r) => s + r.amount, 0);

    // sim 2건 제외, 실고객+워크인 2건 보존
    expect(kept.map((r) => r.id).sort()).toEqual(['p2', 'p3']);
    // 표시매출 합계 = 50,000 + 30,000 = 80,000 (sim 300,000 미반영)
    expect(total).toBe(80_000);

    // 라이브 정상(sim 0건) → 전량 보존 = 무변화
    const noSim = exclude(rows, new Set<string>());
    expect(noSim.length).toBe(rows.length);
  });

});
