/**
 * T-20260808-foot-SALESDOCTOR-DEDUCT-BLANK-REGRESSION-FIX
 * 매출집계 > 담당치료사별 탭 — '차감 매출' 전건 0/blank 회귀 복구 회귀방지.
 *
 * 회귀 RC: deductSessions 쿼리가 `packages` 아래 `customers(...)` 를 임베드하는데
 *   packages→customers FK 가 2개(packages_customer_id_fkey · packages_transferred_to_fkey=패키지 양도)라
 *   PostgREST 가 임베드를 disambiguate 못 함 → PGRST201(HTTP 300) → 쿼리 throw →
 *   deductSessions 전건 소실 → 모든 치료사 '차감 매출' 0/blank.
 *   임베드는 e3e645c9(T-20260806 차감건수 drill-down)가 이 쿼리에 customers 를 추가하며 유입.
 *   fec971f4(deleted_at)·mtmSales(564c20ff)는 무관(교차영향 없음)임을 prod REST 실측으로 확정.
 *
 * FIX: `customers` → `customers!packages_customer_id_fkey` 로 구매자 고객 FK 명시(양도대상 아님).
 *   READ-ONLY / db_change=false. AC-2 불변식(집계 차감매출 === Σ drill-down)은 동일 소스·산식이라 불변.
 *
 * 검증(가능 범위 — 실 prod 데이터 없는 CI 에선 렌더 무오류 + 소스 가드):
 *   시나리오(정상 동선): 담당치료사별 탭 진입 → 표 렌더 → '차감 매출' 셀이
 *     쿼리 에러로 인한 전건 소실(=행 자체 미표시) 상태가 아님을 확인.
 *   소스 가드: deductSessions select 문에 disambiguated FK 힌트가 존재하고
 *     bare `customers(` 임베드(모호)가 재유입되지 않음.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const SALES_URL = `${BASE_URL}/admin/sales`;

// storageState 는 playwright.config 의 desktop-chrome 프로젝트(AUTH_FILE=.auth/user.json)에서 주입.
// (spec-level override 금지 — 잘못된 경로 override 시 로그인 화면으로 리다이렉트되어 tab 미표시.)

async function gotoStaffTab(page: import('@playwright/test').Page) {
  await page.goto(SALES_URL);
  await page.waitForLoadState('networkidle');
  const staffTab = page.getByRole('tab', { name: /담당치료사별/ });
  await staffTab.waitFor({ state: 'visible', timeout: 15000 });
  await staffTab.click();
  await page.waitForLoadState('networkidle');
  await page.getByTestId('sales-preset-month').click().catch(() => {});
  await page.waitForLoadState('networkidle');
  await page.getByTestId('sales-staff-basis-deduction').click().catch(() => {});
  await page.waitForLoadState('networkidle');
}

test.describe('T-20260808 차감 매출 전건 0/blank 회귀 복구', () => {
  test('시나리오: 담당치료사별 탭 진입 → 차감 매출 쿼리 무오류 렌더(전건 소실 아님)', async ({ page }) => {
    const pgrst201: string[] = [];
    page.on('response', async (res) => {
      // deductSessions 쿼리가 PGRST201(HTTP 300 ambiguous embed)로 실패하면 포착.
      if (res.url().includes('/rest/v1/package_sessions') && res.status() === 300) {
        pgrst201.push(res.url());
      }
    });

    await gotoStaffTab(page);

    // 회귀 시 deductSessions 쿼리가 300 으로 죽어 '차감 매출' 전건이 0/blank.
    // FIX 후엔 package_sessions 쿼리가 300 을 반환하지 않아야 한다.
    expect(pgrst201, 'package_sessions deduct 쿼리가 PGRST201(300)로 실패하면 안 됨').toHaveLength(0);

    // 차감 매출 셀이 하나라도 렌더되면(=쿼리 성공) 그 텍스트에 '원' 단위 표기가 있어야 함.
    const revenueCells = page.locator('td[data-testid^="sales-staff-deduct-revenue-"]');
    const count = await revenueCells.count();
    if (count > 0) {
      await expect(revenueCells.first()).toContainText('원');
    }
    // count===0 (해당 기간 차감 데이터 없음)도 정상 — 쿼리 무오류가 본 회귀의 핵심 판정.
  });

  test('소스 가드: deductSessions 임베드가 packages_customer_id_fkey 로 disambiguate 되어 있음', () => {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      resolve(__dirname, '../../src/components/sales/SalesStaffTab.tsx'),
      'utf8',
    );
    // FIX 힌트 존재
    expect(src).toContain('customers!packages_customer_id_fkey(id, name, chart_number)');
    // 모호 임베드(bare customers) 재유입 금지 — packages 블록 내 bare `customers(` 부활 방지.
    expect(src).not.toContain('\n            customers(id, name, chart_number)');
  });
});
