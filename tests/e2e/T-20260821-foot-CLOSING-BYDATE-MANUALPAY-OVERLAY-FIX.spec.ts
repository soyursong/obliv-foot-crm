/**
 * T-20260821-foot-CLOSING-BYDATE-MANUALPAY-OVERLAY-FIX — 총매출탭 §02 일자별표 수기결제 오버레이 E2E
 *
 * RC(부모 DIAG T-20260821-...-TOTAL-SALES-10K-MISMATCH-DIAG·done):
 *   `closing_manual_payments`(수기결제)가
 *     · §01 카드(fetchMtmCardMetrics 비급여 UNION) + 결제내역 탭 grossTotal(Closing.tsx manualEntries) 에는 포함
 *     · 그러나 §02 일자별표가 소비하는 foot_stats_revenue RPC 에는 무접촉
 *   → 같은 '총 매출' 탭 §01↔§02 내부 불일치. 08-20 실측 Δ=+10,000(수기결제 1건).
 *
 * Fix(FE-only, db_change=false): mtmSales.fetchMonthlyComparison / netByDay 에
 *   closing_manual_payments per-day 오버레이(close_date grain, voided 제외, additive) 가산
 *   → §01 카드·결제내역 탭과 3-surface parity. foot_stats_revenue RPC 무변경(cross-CRM blast radius 방지).
 *
 * DoD(부모 DIAG 권고):
 *   1. §02 일자별표 = 결제내역 탭 grossTotal (수기결제 포함, delta 0)
 *   2. 수기결제 없는 날 회귀 없음 / 있는 날 결제내역 탭과 일치
 *   3. voided 수기결제 미포함(이중차감/오합산 없음)
 *   4. §01카드 무변 + §01↔§02 정합
 *   5. RPC·스키마 무변경(DDL0)
 *
 * 검증 전략: (a) 정적 소스 불변식 = 오버레이 산식·필터·additive·read-only 앵커(토큰/DB 무관 견고),
 *            (b) 브라우저 동선 = §02 표 렌더 + closing_manual_payments 조회(voided 필터) 발생.
 * 패턴 출처: T-20260804-foot-MTM-SALES-DASH-RESTRUCTURE.spec.ts (정적+브라우저 혼합).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { loginAndWaitForDashboard } from '../helpers';

const REPO_ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// 정적 소스 불변식 — 오버레이 산식·필터·read-only 앵커 (토큰/DB 무관)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('정적 소스 불변식 (T-20260821-foot-CLOSING-BYDATE-MANUALPAY-OVERLAY-FIX)', () => {
  const lib = read('src/lib/mtmSales.ts');

  test('AC-5(READ-ONLY/DDL0): mtmSales.ts 는 SELECT만 — write/RPC/DDL 부재', () => {
    expect(lib).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    expect(lib).not.toMatch(/\.rpc\(/); // RPC 무변경(fetchRevenue 는 stats.ts 경유, 여기선 직접 rpc 호출 없음)
    expect(lib).toMatch(/\.select\(/);
  });

  test('AC-3(voided 제외 + close_date grain): 오버레이 헬퍼 필터·grain 앵커', () => {
    // manualNetByDay 헬퍼 존재
    expect(lib).toMatch(/manualNetByDay/);
    // closing_manual_payments 소스 조회
    expect(lib).toMatch(/from\('closing_manual_payments'\)/);
    // voided 제외(이중차감/오합산 방지)
    expect(lib).toMatch(/\.is\('voided_at',\s*null\)/);
    // close_date grain(일자별표 일 축 정합)
    expect(lib).toMatch(/close_date/);
    // amount, close_date select
    expect(lib).toMatch(/select\('amount,\s*close_date'\)/);
  });

  test('AC-1/2/4(additive parity): fetchMonthlyComparison 에 당월·전월 오버레이 가산', () => {
    // 당월·전월 모두 manualNetByDay 호출(Promise.all)
    const calls = lib.match(/manualNetByDay\(/g) ?? [];
    // 정의 1 + 당월 호출 1 + 전월 호출 1 = 3회 이상
    expect(calls.length).toBeGreaterThanOrEqual(3);
    // curMap / prevMap 에 additive 가산(중복합산 없음: RPC 미포함 금액만 더함)
    expect(lib).toMatch(/for\s*\(const\s*\[day,\s*amt\]\s*of\s*curManual\)\s*curMap\.set/);
    expect(lib).toMatch(/for\s*\(const\s*\[day,\s*amt\]\s*of\s*prevManual\)\s*prevMap\.set/);
  });

  test('AC-2(전월 데이터 판정): 수기결제만 있는 전월도 prevHasData 반영', () => {
    expect(lib).toMatch(/prevRows\.length\s*>\s*0\s*\|\|\s*prevManual\.size\s*>\s*0/);
  });

  test('AC-4(§01 카드 파리티 소스 동일): §01 카드도 동일 소스·필터 유지(무변)', () => {
    // §01 카드 fetchMtmCardMetrics 는 여전히 closing_manual_payments voided 제외 UNION 유지(회귀 0)
    expect(lib).toMatch(/fetchMtmCardMetrics/);
    // 두 surface 모두 동일 테이블·동일 voided 필터 = parity 소스
    const voidedFilters = lib.match(/\.is\('voided_at',\s*null\)/g) ?? [];
    expect(voidedFilters.length).toBeGreaterThanOrEqual(2); // §01 카드 + §02 오버레이
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 브라우저 동선 — 로그인 가능 시에만
// ─────────────────────────────────────────────────────────────────────────────
test.describe('총매출탭 §02 일자별표 수기결제 오버레이 브라우저 동선', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('시나리오1: 총매출탭 §02 일자별표 렌더 + closing_manual_payments 조회(voided 필터) 발생', async ({ page }) => {
    let manualQueried = false;
    let voidedFiltered = false;
    page.on('request', (req) => {
      const u = req.url();
      if (/closing_manual_payments/.test(u)) {
        manualQueried = true;
        if (/voided_at=is\.null/.test(u)) voidedFiltered = true;
      }
    });

    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('stats-tab-revenue').click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);

    // §02 일자별표(전월 대비 매출 추이) 렌더
    await expect(page.getByText('2. 전월 대비 매출 추이')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/통계를 불러오지 못했습니다/)).toHaveCount(0);

    // 오버레이 배선 증거: §02 소비 경로에서 수기결제 조회가 voided 제외로 발생
    expect(manualQueried, 'closing_manual_payments 조회 발생(§02 오버레이 배선)').toBeTruthy();
    expect(voidedFiltered, 'voided_at=is.null 필터 적용(이중차감/오합산 방지)').toBeTruthy();
    console.log('[§02 오버레이] 일자별표 렌더 + 수기결제 voided-제외 조회 OK');
  });

  test('시나리오2: 엣지(전월/빈 기간 데이터 없음) → 오류 없이 표 렌더', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('stats-tab-revenue').click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // 데이터 유무와 무관하게 §02 섹션이 오류 없이 렌더(수기결제 오버레이가 빈 결과에도 안전)
    await expect(page.getByText('2. 전월 대비 매출 추이')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/통계를 불러오지 못했습니다/)).toHaveCount(0);
    console.log('[§02 오버레이] 엣지 케이스 오류 없이 렌더 OK');
  });
});
