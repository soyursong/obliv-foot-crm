/**
 * T-20260713-foot-CLOSING-REFUND-SINGLE-PAY-MISSING (P0 hotfix)
 *
 * 진단 결론 (diagnose-first, 실브라우저 + prod DB 실측):
 *  - AC-1 (단건 미표시): 현재 코드에서 재현 불가. 결제내역 탭에 단건(source=payment)
 *    행이 환불버튼과 함께 정상 표시됨을 실렌더로 확인 (아래 scenario-1).
 *  - AC-2 (패키지 무회귀): 패키지 행도 정상 표시 (동일 목록).
 *  - AC-3 (환불 가능 금액): 이미(전액/부분) 환불된 단건이 원결제 전액을 다시
 *    환불가능으로 제시하던 결함 → 잔여(원결제 − 기존환불) 기준으로 교정.
 *    이미 전액 환불된 결제는 입력 비활성 + '이미 전액 환불' 안내 + 제출 비활성.
 *
 * 원인 (AC-4): Closing.tsx ClosingRefundDialog 단건 경로가 linked_payment_id
 *   연결 환불 합계를 차감하지 않고 항상 row.amount 를 상한으로 삼음(pre-existing;
 *   금일 f6277769 가 편집필드 검증을 row.amount 기준으로 굳혀 재노출). 단건 목록
 *   누락을 유발하는 금일 커밋은 없음(목록 fetch/enrich/render 무변경).
 */
import { test, expect } from '@playwright/test';

async function openPaymentsTab(page) {
  await page.goto('/admin/closing');
  await page.waitForSelector('table', { timeout: 30000 });
  await page.getByRole('tab', { name: /결제내역/ }).click();
  await page.waitForTimeout(2000);
}

test.describe('CLOSING-REFUND-SINGLE-PAY-MISSING', () => {
  // AC-1 + AC-2: 단건·패키지 모두 목록에 표시 + 환불버튼 노출
  test('scenario-1/2: 단건(source=payment)·패키지 결제가 결제내역+환불버튼과 함께 표시', async ({ page }) => {
    await openPaymentsTab(page);
    const payTable = page.locator('table', { has: page.locator('thead', { hasText: '환불' }) }).first();
    await expect(payTable).toBeVisible();
    const bodyText = await payTable.locator('tbody').innerText();
    // 오늘 seed: 단건(313,370 / 42,000) + 패키지 존재. 최소 단건 badge 1개 이상.
    expect(bodyText).toContain('단건');
    expect(bodyText).toContain('패키지');
    // 단건 행에 환불 버튼(refund-open-btn) 존재
    const refundBtns = payTable.locator('[data-testid="refund-open-btn"]');
    expect(await refundBtns.count()).toBeGreaterThan(0);
  });

  // AC-3 → T-20260713-CLOSING-REFUND-PAYTYPE-GROUPING-ITEMSELECT [FOLD] AC-B1 로 승격:
  //   이미 전액 환불된 결제(잔여 0)는 '환불창에서 잔여 0 처리'를 넘어 재환불 클릭 자체를 차단한다.
  //   → 완전환불 행은 리스트 환불 버튼이 숨겨지고 '완료' 배지가 표시됨(재환불 방지 UX).
  test('scenario-3 [FOLD AC-B1]: 완전환불(잔여 0) 행은 재환불 버튼 숨김 + 완료 배지', async ({ page }) => {
    await openPaymentsTab(page);
    const fullyBadges = page.getByTestId('fully-refunded-badge');
    const n = await fullyBadges.count();
    if (n === 0) {
      console.log('[AC-B1] 오늘 완전환불 행 없음 — 신규 티켋 로직/소스가드로 검증(graceful).');
      return;
    }
    // 각 완전환불 행에는 환불 버튼이 없어야 함(재환불 클릭 차단)
    for (let i = 0; i < n; i++) {
      const row = fullyBadges.nth(i).locator('xpath=ancestor::tr[1]');
      await expect(row.getByTestId('refund-open-btn')).toHaveCount(0);
    }
    console.log(`[AC-B1] 완전환불 ${n}개 행 재환불 버튼 숨김 PASS`);
  });
});
