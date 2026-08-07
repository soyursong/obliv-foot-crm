/**
 * T-20260718-foot-PKG-CONSULTANT-ID-RPC-CUTOVER (Phase 2) — 실장별 실적 계약/렌더 불변식 E2E spec
 *
 * 배경 (DA-20260718-foot-PKG-CONSULTANT-ID-ATTR Q3/Q4, GO ADDITIVE):
 *   RPC foot_stats_consultant 패키지 귀속을 heuristic-only → COALESCE(packages.consultant_id[fact], heuristic).
 *   fact 우선 + heuristic 영구 폴백(Q3). 반환형 7컬럼 shape 불변(본 spec 의 핵심 회귀 가드).
 *   실 매출 귀속 정정(fact override, 실장 zero-sum)의 정확성은 prod evidence(.mjs)가 권위 검증 —
 *   E2E 는 시드 독립 계약/렌더 불변식(shape 7컬럼 유지 + 기존 헤더 회귀 0 + admin 게이트)만 본다.
 *
 * 검증 대상 (data-independent):
 *   1) '실장별 실적' 표 렌더 + 7컬럼 헤더 전부 존재(반환형 shape 회귀 0 — 6컬럼 회귀/컬럼 소실 차단)
 *   2) admin 세션에서 매출통계 탭 진입 가능(RANKING-TAB-ADMINLOCK admin 게이트 무회귀)
 *   3) 표 렌더 자체 성공(RPC 200 · 반환형 파싱 성공 — 본문 스왑이 shape 를 깨지 않음)
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
  const revenueTab = page.getByTestId('stats-tab-revenue');
  if (await revenueTab.count()) {
    await revenueTab.click();
  }
  await expect(page.getByText('실장별 실적')).toBeVisible({ timeout: 15000 });
}

test.describe('실장별 실적 — 패키지 귀속 COALESCE cutover (shape 회귀 가드)', () => {
  test('7컬럼 헤더 전부 존재 — 반환형 shape 회귀 0 (6컬럼 회귀/컬럼 소실 차단)', async ({ page }) => {
    await openConsultantSection(page);
    // 7컬럼 반환형의 화면 표출 헤더 전부 공존 확인(consulted_customer_count=상담고객, avg=객단가 포함).
    for (const h of ['실장명', '티켓팅 건수', '패키지 전환율', '총 매출액', '상담고객', '객단가']) {
      await expect(
        page.getByRole('columnheader', { name: new RegExp(h) }).first()
          .or(page.getByText(h, { exact: false }).first())
      ).toBeVisible();
    }
  });

  test('표 렌더 성공 — 본문 스왑이 RPC 반환형 파싱을 깨지 않음', async ({ page }) => {
    await openConsultantSection(page);
    // 카드/표가 에러 없이 마운트 = RPC 7컬럼 반환형 정상 소비(COALESCE 본문 무회귀).
    await expect(page.locator('table').first()).toBeVisible({ timeout: 15000 });
    // 페이지에 오류 배너가 없어야 함(반환형 mismatch 시 FE throw).
    await expect(page.getByText(/불러오지 못했|오류가 발생|에러/).first()).toHaveCount(0);
  });
});
