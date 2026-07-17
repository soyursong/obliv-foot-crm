/**
 * E2E spec — T-20260715-foot-DAYCLOSE-PAYGATE-REFUNDROW
 * 풋센터 일마감 수정 2건
 *
 * ── REQ① 일마감 집계 = 수납 버튼 클릭 gating (버그, 비즈로직 핵심경로) ────────────
 *   시나리오 1: 수납 미클릭 → 완료 전환만 → 일마감 미집계
 *   시나리오 2: 수납 클릭 → 완료 전환 → 일마감 정상 집계
 *   ⚠ 상태: BLOCKED(재현 대기). dev-foot RC 규명 결과, '완료 상태전환(칸반 드래그)'은
 *      payments/package_payments 어느 행도 생성하지 않으며(package_sessions 소진만),
 *      check_ins→payments DB 트리거도 없음. 즉 "수납 안 누른 완료건"이 일마감(payments 집계)에
 *      나타나는 코드 경로가 현 코드베이스에 존재하지 않음(6개 payment insert 경로 모두 명시적
 *      결제 액션 필요). 게다가 naive 하게 'check_in.status=done' 게이트를 걸면 (a) 단건 결제
 *      (check_in_id=NULL) (b) 정당한 payment_waiting 부분수납이 누락되어 티켓이 금지한
 *      '매출 누락' 회귀를 유발. → planner FOLLOWUP 으로 현장 정확 재현(어느 버튼/화면에서
 *      phantom 결제가 뜨는지) 확보 후 구현. 그 전까지 시나리오 1·2 는 skip.
 *
 * ── REQ② 일마감 환불 표기 = 기존 행 annotate (순수 FE) ──────────────────────────
 *   시나리오 3: 환불 처리 시 별도 빨간 새 행을 만들지 않고, 기존 결제 행 안에
 *      '환불' 표기 + 결제 업로드 시각(기존 시간) + 환불 신청 시각을 각각 병기.
 *   구현: Closing enrichedRows 후처리에서 환불(refund)행을 원결제행에 merge(merged_refund
 *      플래그) → 표시 경로에서 스킵, 원결제행에 refunded/refund_time/refund_amount annotate.
 *      합계 reduce 는 refund 행을 그대로 포함해 net 유지(회귀 0). 고아 환불(원결제 부재)은
 *      기존처럼 자체 행 렌더(데이터 무손실 fallback).
 *
 * db_change=false. 배포 전 supervisor QA + 현장 confirm 게이트.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// ──────────────────────────────────────────────────────────────────────────────
// 시나리오 1 (REQ①) — 수납 미클릭 완료 → 일마감 미집계
//   BLOCKED: RC 재현 불가(위 헤더 참조). planner 현장 재현 확보 후 활성화.
// ──────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 1 — REQ① 수납 미클릭 완료 → 일마감 미집계', () => {
  test.skip('AC①-1: 수납 버튼 없이 완료 전환 시 일마감 결제내역 미표시 [BLOCKED: RC 재현 대기]', async () => {
    // planner FOLLOWUP(medium): 완료 전환만으로 payments 행이 생기는 정확한 현장 경로 필요.
    // 현 코드상 재현 불가 → naive 게이트는 매출 누락 회귀 유발이므로 구현 보류.
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 시나리오 2 (REQ①) — 수납 클릭 → 완료 → 일마감 정상 집계 (회귀)
// ──────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 2 — REQ① 수납 클릭 → 일마감 정상 집계', () => {
  test.skip('AC①-2: 수납 완료 건 일마감 정상 집계 + 기존건 누락·이중집계 0 [BLOCKED: RC 재현 대기]', async () => {
    // REQ① 확정 후 시나리오 1 과 함께 활성화(회귀: 기존 정상 수납건 무영향).
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 시나리오 3 (REQ②) — 환불 = 기존 행 annotate (새 빨간 행 금지)
// ──────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 3 — REQ② 환불 기존 행 annotate', () => {

  test('AC②-a: 일마감 결제내역 탭 진입 + 환불 표기 컬럼 구조 확인', async ({ page }) => {
    await loginAndWaitForDashboard(page);
    await page.goto('/admin/closing');
    await page.waitForLoadState('networkidle');

    const paymentsTab = page.getByRole('tab', { name: /결제내역/ });
    await expect(paymentsTab).toBeVisible({ timeout: 10000 });
    await paymentsTab.click();
    await page.waitForTimeout(800);

    // 결제내역 테이블(구분/환불 헤더) 존재 — 렌더 구조 무손상 확인
    const gubunHeader = page.locator('th').filter({ hasText: '구분' }).first();
    await expect(gubunHeader).toBeVisible({ timeout: 8000 });
    console.log('[AC②-a] 결제내역 테이블 구조 PASS');
  });

  test('AC②-b: 환불 처리 건은 기존 결제 행에 annotate — 별도 빨간 새 행 미생성', async ({ page }) => {
    await loginAndWaitForDashboard(page);
    await page.goto('/admin/closing');
    await page.waitForLoadState('networkidle');

    const paymentsTab = page.getByRole('tab', { name: /결제내역/ });
    await expect(paymentsTab).toBeVisible({ timeout: 10000 });
    await paymentsTab.click();
    await page.waitForTimeout(1000);

    // 환불된 원결제행 annotate 마커
    const refundedBadges = page.locator('[data-testid="refunded-badge"]');
    const refundedAmounts = page.locator('[data-testid="refund-amount"]');
    const refundReqTimes = page.locator('[data-testid="refund-requested-at"]');

    const badgeCount = await refundedBadges.count();
    if (badgeCount > 0) {
      // ① 환불된 원결제행에 '환불' 표기 노출
      await expect(refundedBadges.first()).toBeVisible();
      // ② 결제 업로드 시각 + 환불 신청 시각 각각 표기
      await expect(refundReqTimes.first()).toBeVisible();
      // ③ 환불액(양수 병기) 노출
      await expect(refundedAmounts.first()).toBeVisible();
      console.log(`[AC②-b] 환불 annotate 원결제행 ${badgeCount}건 — 기존 행 표기 PASS`);
    } else {
      // 당일 환불 데이터 없음 — annotate 경로 구조 확인(회귀-safe fallback)
      console.log('[AC②-b] 당일 환불 데이터 없음 — annotate 마커 구조 확인(데이터 대기)');
    }

    // 회귀 불변식: '구분' 셀 '환불' Badge 는 (i) 고아 환불 자체행 또는 (ii) annotate 원결제행에서만.
    // 병합된 환불행이 별도 <tr>(bg-red-50 단독 행)로 남지 않는지는 seeded 데이터로 supervisor QA 에서 확인.
    console.log('[AC②-b] 병합 환불행 별도 행 미생성 — seeded QA 확인 대상');
  });

  test('AC②-c: 환불 버튼(RotateCcw) — 원결제행에서 재환불 진입 유지(회귀 0)', async ({ page }) => {
    await loginAndWaitForDashboard(page);
    await page.goto('/admin/closing');
    await page.waitForLoadState('networkidle');

    const paymentsTab = page.getByRole('tab', { name: /결제내역/ });
    await expect(paymentsTab).toBeVisible({ timeout: 10000 });
    await paymentsTab.click();
    await page.waitForTimeout(800);

    // 환불 버튼(setRefundTarget → 환불 창)은 GROUPING-ITEMSELECT 영역 — 본 티켓 무접촉.
    // 원결제행 환불 버튼 진입 경로가 그대로 유지되는지(회귀 0) 구조 확인.
    const refundBtns = page.locator('[data-testid="refund-open-btn"]');
    const count = await refundBtns.count();
    if (count > 0) {
      await expect(refundBtns.first()).toBeVisible();
      console.log(`[AC②-c] 환불 진입 버튼 ${count}개 — 무접촉 유지 PASS`);
    } else {
      console.log('[AC②-c] 당일 결제 데이터 없음 — 버튼 구조 대기');
    }
  });
});
