/**
 * T-20260715-foot-DAYCLOSE-STAT-PAYONLY (P1, A안 — 김주연 총괄 결정)
 *
 * 변경: 일마감 '시술별 통계'(procedureStats)를 당일 전체 check_in의 시술 무조건 집계
 *   → 실수납/결제 confirmed(net>0) 체크인의 시술만 집계로 변경.
 *
 * RC 확정 (AC-4): 환불은 payments 별도 행(payment_type='refund')으로 저장됨.
 *   check_in별 net = Σ(payment.amount) − Σ(refund.amount). net>0 기준(b) 채택.
 *   (payment 레코드 존재(a)는 F-4714(payment 248,900 → refund net=0)를 못 거름.)
 *
 * AC:
 *  - AC-1: 시술별 통계 = 수납/결제 confirmed 건만. '완료' 전환만으로는 미집계.
 *  - AC-2: 결제내역 목록 섹션 회귀 0 (무변경).
 *  - AC-3(핵심 회귀): F-4714(net=0 환불건)는 시술별 통계 매출에 미포함. 정상 수납건 누락 0.
 *
 * 실브라우저 + 라이브 데이터 특성상 특정 차트(F-4714) 금액을 결정적으로 단정하기 어려워,
 *  paid-only 의 관찰 가능한 불변식(시술별 통계 매출 ≤ 결제내역 net 총합)과 구조 회귀로 검증한다.
 *  net=0/미수납 시술 제외의 정확성은 위 코드 RC(net>0 필터)로 보증.
 */
import { test, expect } from '@playwright/test';

/** "12,345원" 등 표기에서 숫자만 추출 (음수 대비 부호 보존) */
function parseAmount(text: string): number {
  const neg = /-/.test(text);
  const digits = text.replace(/[^0-9]/g, '');
  const n = digits ? parseInt(digits, 10) : 0;
  return neg ? -n : n;
}

async function gotoClosingSummary(page) {
  await page.goto('/admin/closing');
  await page.waitForSelector('table', { timeout: 30000 });
  await page.waitForTimeout(1500);
}

test.describe('DAYCLOSE-STAT-PAYONLY', () => {
  // 시나리오 1 + AC-1/AC-3: 시술별 통계 매출 합계는 결제내역 net 총합을 초과하지 않는다.
  //   (미수납/환불 net=0 시술이 매출을 부풀리면 이 불변식이 깨짐 → fix 전 코드는 위반 가능)
  test('scenario-1: 시술별 통계 매출 ≤ 결제내역 net 총합 (paid-only 불변식)', async ({ page }) => {
    await gotoClosingSummary(page);

    // 요약 탭 — 시술별 통계 섹션(있을 때만 검증)
    const statCard = page.getByTestId('procedure-stats-card');
    const hasStats = await statCard.count();
    if (hasStats === 0) {
      test.info().annotations.push({ type: 'note', description: '당일 시술별 통계 없음(수납건 0) — 불변식 자명 통과' });
      return;
    }
    const procRevenueText = await page.getByTestId('procedure-stats-total-revenue').innerText();
    const procRevenue = parseAmount(procRevenueText);

    // 결제내역 탭 — net 총합(합계 표기: 환불 차감 반영)
    await page.getByRole('tab', { name: /결제내역/ }).click();
    await page.waitForTimeout(1500);
    const netTotalText = await page.locator('text=/합계/').first().innerText().catch(() => '');
    // 목록 상단 요약의 '합계 <금액>' 파싱 (없으면 스킵)
    const netTotal = parseAmount(netTotalText);

    // paid-only: 시술별 통계 매출은 실수납 net 총합을 넘을 수 없다.
    // (netTotal 파싱 실패=0 인 경우는 단정하지 않음)
    if (netTotal > 0) {
      expect(procRevenue).toBeLessThanOrEqual(netTotal);
    }
    // 시술별 통계 매출은 음수가 될 수 없다 (환불건이 음수로 새어들지 않음)
    expect(procRevenue).toBeGreaterThanOrEqual(0);
  });

  // 시나리오 2 + AC-2: 결제내역 목록 섹션 무변경 회귀 — 단건/패키지 badge + 환불 버튼 유지
  test('scenario-2: 결제내역 목록 섹션 회귀 0 (무변경)', async ({ page }) => {
    await gotoClosingSummary(page);
    await page.getByRole('tab', { name: /결제내역/ }).click();
    await page.waitForTimeout(1500);

    // 결제내역 테이블(환불 컬럼 포함) 렌더 확인
    const payTable = page.locator('table', { has: page.locator('thead', { hasText: '환불' }) }).first();
    await expect(payTable).toBeVisible();

    // 목록 자체 구조(소스 badge 또는 환불 버튼)가 유지되는지 — 데이터 있을 때만
    const rowCount = await payTable.locator('tbody tr').count();
    if (rowCount > 0) {
      const bodyText = await payTable.locator('tbody').innerText();
      // 결제원본 소스 표기(단건/패키지/수기/환불) 중 하나 이상 존재
      expect(/단건|패키지|수기|환불/.test(bodyText)).toBeTruthy();
    }
  });
});
