/**
 * E2E Spec — T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT (Part1, read-side)
 *
 * 현장 P0(김주연 총괄): 급여환자 수납 시 결제 미니창(PaymentMiniWindow) 수납잔액이 공단부담금까지
 *   합산돼 환자에게 과청구되던 문제. 오늘 전 급여환자 수기 등록 중(운영 중단 수준).
 *
 * 확정 스펙(Part1):
 *   수납잔액(환자 실수납, payments 기록) = 급여 본인부담금(copayment) + 비급여 전액.
 *   공단부담금(coveredTotal − copayment = is_insurance_covered 커버분)은 수납잔액에서 제외.
 *   예: 급여 30,000(본인+공단) + 비급여 5,000 → payableTotal = copayment + 5,000, 공단분 제외.
 *
 * 구현 원칙(qa-fail 방지):
 *   본인/공단 split 은 배포된 SSOT computeFootBilling(8239350e, DOCPRINT-RECUR)을 재사용한다.
 *   PMW 인라인 재계산(병렬 경로)은 grade=null 시 copaymentTotal=0 으로 SSOT(본인=급여전액/공단=0)와
 *   divergence 하던 버그 소스 → 제거. 본 spec 은 PMW 가 산출하는 payableTotal 을
 *   `computeFootBilling(...).copaymentTotal + .nonCoveredTotal` 로 순수 대비해 3-시나리오를 단언한다.
 *   실브라우저 수납 흐름 육안 대조는 supervisor QA.
 *
 * 실행: npx playwright test T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT.spec.ts
 */

import { test, expect } from '@playwright/test';
import {
  computeFootBilling,
  type FootBillingItem,
  type BillingService,
} from '../../src/lib/footBilling';

const svc = (over: Partial<BillingService> & { id: string; name: string }): BillingService => ({
  service_code: null, hira_code: null, vat_type: 'none',
  is_insurance_covered: false, category_label: null, price: 0, ...over,
});

/**
 * PMW(PaymentMiniWindow) 가 산출하는 수납잔액과 1:1 동일한 순수 파생.
 *   src/components/PaymentMiniWindow.tsx:
 *     const footBilling = computeFootBilling(footBillingItems, grade)
 *     const payableTotal = footBilling.copaymentTotal + footBilling.nonCoveredTotal
 */
function pmwPayableTotal(items: FootBillingItem[], grade: Parameters<typeof computeFootBilling>[1]): number {
  const fb = computeFootBilling(items, grade);
  return fb.copaymentTotal + fb.nonCoveredTotal;
}

/** 급여 30,000(hira_code 보유) + 비급여 5,000 혼합 방문 — 티켓 예시 재현. */
const MIXED_VISIT: FootBillingItem[] = [
  { service: svc({ id: 'g1', name: '급여 시술', service_code: 'AA100', hira_code: 'AA100', is_insurance_covered: true, category_label: '기본', price: 30000 }), qty: 1, unitPrice: 30000 },
  { service: svc({ id: 'n1', name: '비급여 레이저', service_code: 'SZ035', is_insurance_covered: false, category_label: '풋케어', price: 5000 }), qty: 1, unitPrice: 5000 },
];

test.describe('T-20260714 PMW 수납잔액 = 본인부담금 + 비급여 (공단부담금 제외)', () => {
  test('시나리오1 급여환자(general 30%): payableTotal = 본인부담금 + 비급여, 공단부담금 제외', () => {
    const fb = computeFootBilling(MIXED_VISIT, 'general');
    // 급여 30,000 → 본인부담금 = ceil(30000*0.3/100)*100 = 9,000, 공단부담금 = 21,000.
    expect(fb.coveredTotal).toBe(30000);
    expect(fb.copaymentTotal).toBe(9000);
    expect(fb.liveBillingValues.insuranceCovered).toBe(21000); // 공단부담금
    expect(fb.nonCoveredTotal).toBe(5000);
    expect(fb.grandTotal).toBe(35000); // 총 진료비(급여전액+비급여)

    // ★ 수납잔액 = 본인부담금(9,000) + 비급여(5,000) = 14,000. 공단부담금(21,000) 제외.
    const payable = pmwPayableTotal(MIXED_VISIT, 'general');
    expect(payable).toBe(14000);
    // 회귀 방지: 수납잔액 ≠ 총 진료비(공단부담금이 빠졌음을 구조적으로 증명).
    expect(payable).not.toBe(fb.grandTotal);
    expect(fb.grandTotal - payable).toBe(fb.liveBillingValues.insuranceCovered); // 차이 = 공단부담금
  });

  test('시나리오2 비급여만(무파괴 회귀): 급여 0 → payableTotal = 비급여 전액 = 총 진료비(변화 없음)', () => {
    const NONCOVERED_ONLY: FootBillingItem[] = [
      { service: svc({ id: 'n1', name: '비급여 레이저', service_code: 'SZ035', is_insurance_covered: false, category_label: '풋케어', price: 5000 }), qty: 1, unitPrice: 5000 },
    ];
    const fb = computeFootBilling(NONCOVERED_ONLY, 'general');
    expect(fb.coveredTotal).toBe(0);
    expect(fb.copaymentTotal).toBe(0);
    expect(fb.nonCoveredTotal).toBe(5000);

    const payable = pmwPayableTotal(NONCOVERED_ONLY, 'general');
    expect(payable).toBe(5000);
    // 급여가 없으면 공단분도 없어 수납잔액 = 총 진료비(기존 동작 유지, 회귀 0).
    expect(payable).toBe(fb.grandTotal);
  });

  test('시나리오3 grade=null 엣지: 본인=급여전액/공단=0(DOCPRINT-RECUR) → payableTotal = 총 진료비', () => {
    const fb = computeFootBilling(MIXED_VISIT, null);
    // 등급 미입력/조회실패 → 본인부담금 = 급여 진료비 전액, 공단부담금 = 0.
    expect(fb.coveredTotal).toBe(30000);
    expect(fb.copaymentTotal).toBe(30000);
    expect(fb.liveBillingValues.insuranceCovered).toBe(0); // 공단 = 0(환자가 급여분 전액 부담)

    // 수납잔액 = 급여전액(30,000) + 비급여(5,000) = 35,000 = 총 진료비.
    const payable = pmwPayableTotal(MIXED_VISIT, null);
    expect(payable).toBe(35000);
    expect(payable).toBe(fb.grandTotal);
  });

  test('버그 가드: 제거된 인라인 경로(grade=null → copayment=0)였다면 급여 30,000 증발(과소수납)했을 것', () => {
    // OLD PMW 인라인: copaymentTotal = copayRate!==null && coveredTotal>0 ? ... : 0
    //   → grade=null 이면 copayment=0 → payable = 0 + 비급여 = 5,000 (급여 30,000 미수납 = 매출 증발/과소청구).
    // SSOT computeFootBilling 통일로 이 divergence 를 닫는다(시나리오3 = 35,000).
    const legacyCopayNullGrade = 0; // 구 인라인 산출값(재현)
    const legacyPayable = legacyCopayNullGrade + computeFootBilling(MIXED_VISIT, null).nonCoveredTotal;
    expect(legacyPayable).toBe(5000); // 버그 재현: 급여분 전액 누락
    // 수정 후(SSOT) 는 35,000 으로 divergence 해소.
    expect(pmwPayableTotal(MIXED_VISIT, null)).not.toBe(legacyPayable);
    expect(pmwPayableTotal(MIXED_VISIT, null)).toBe(35000);
  });

  test('회귀가드: 유효 등급(general)은 100원 절상 기존 산식 유지(본인 9,000)', () => {
    const fb = computeFootBilling(MIXED_VISIT, 'general');
    expect(fb.copaymentTotal).toBe(9000); // ceil(30000*0.3/100)*100 — 회귀 0
  });
});
