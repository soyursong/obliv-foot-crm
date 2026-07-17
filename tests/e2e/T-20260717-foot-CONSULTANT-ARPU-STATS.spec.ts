/**
 * T-20260717-foot-CONSULTANT-ARPU-STATS (AC6) — 상담실장별 객단가(ARPU) E2E spec
 *
 * 배경 (DA-20260717-FOOT-CONSULTANT-ARPU-AC6, GO ADDITIVE):
 *   통계 > 매출통계 탭 '실장별 실적'의 객단가(avg_amount) 분모를
 *   상담'건수'(ticketing_count) → 상담'고객수'(distinct 상담고객, consulted_customer_count)로 pin.
 *   RPC foot_stats_consultant 반환형 6→7컬럼(consulted_customer_count 신규 ADDITIVE).
 *   avg_amount = total_amount ÷ NULLIF(distinct 상담고객, 0) — 분모=0 → NULL('-' 표시).
 *   dual-axis grain: 분자 accounting_date / 분모 checked_in_at (의도된 설계).
 *
 * 검증 대상 (data-independent — 시드 없이 계약/렌더 불변식만):
 *   1) '실장별 실적' 표에 '상담고객' 컬럼 헤더 + '객단가' 컬럼 헤더 공존
 *   2) dual-null 불변식: 상담고객 셀이 '-'(0명)인 행은 객단가 셀도 '-' (분모 0 → NULL)
 *   3) 기존 컬럼 회귀 0 (실장명/티켓팅 건수/패키지 전환율/총 매출액 헤더 유지)
 *
 * READ-ONLY — DB 변경 없음.
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const STATS_URL = `${BASE_URL}/admin/stats`;

test.use({ storageState: 'playwright/.auth/user.json' });

async function openConsultantSection(page) {
  await page.goto(STATS_URL);
  await page.waitForLoadState('networkidle');
  // 매출통계 탭 (ConsultantSection 노출)
  const revenueTab = page.getByTestId('stats-tab-revenue');
  if (await revenueTab.count()) {
    await revenueTab.click();
  }
  // 로딩 종료 대기 — '실장별 실적' 카드 등장
  await expect(page.getByText('실장별 실적')).toBeVisible({ timeout: 15000 });
}

test.describe('상담실장별 객단가(ARPU) — 상담고객당 분모 pin', () => {
  test('상담고객 + 객단가 컬럼 공존 + 기존 헤더 회귀 0', async ({ page }) => {
    await openConsultantSection(page);

    // 신규 + 기존 헤더 공존 (컬럼 스코프: 실장별 실적 표 헤더)
    for (const h of ['실장명', '티켓팅 건수', '패키지 전환율', '총 매출액', '상담고객', '객단가']) {
      await expect(page.getByRole('columnheader', { name: new RegExp(h) }).first()
        .or(page.getByText(h, { exact: false }).first())).toBeVisible();
    }
  });

  test('dual-null 불변식: 상담고객 "-"(0명) 인 행은 객단가도 "-"', async ({ page }) => {
    await openConsultantSection(page);

    const rows = page.locator('table tbody tr');
    const n = await rows.count();
    test.skip(n === 0, '기간 내 실장 실적 데이터 없음 — 불변식 검증 스킵');

    for (let i = 0; i < n; i++) {
      const cells = rows.nth(i).locator('td');
      const c = await cells.count();
      if (c < 6) continue; // 실장별 실적 표(6컬럼): 실장명/티켓팅/전환/총매출/상담고객/객단가
      // 컬럼 순서: [0]실장명 [1]티켓팅 [2]전환율 [3]총매출 [4]상담고객 [5]객단가
      const consulted = (await cells.nth(4).textContent())?.trim() ?? '';
      const avg = (await cells.nth(5).textContent())?.trim() ?? '';
      if (consulted === '-') {
        // 분모 0 → RPC NULL → 객단가 '-' 이어야 함
        expect(avg, `상담고객 '-' 행의 객단가는 '-' 여야 함 (row ${i})`).toBe('-');
      }
    }
  });
});
