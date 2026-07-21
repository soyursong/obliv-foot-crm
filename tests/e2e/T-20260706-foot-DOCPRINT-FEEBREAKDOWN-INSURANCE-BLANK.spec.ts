/**
 * E2E Spec — T-20260706-foot-DOCPRINT-FEEBREAKDOWN-INSURANCE-BLANK
 *
 * 진료비 세부산정내역(bill_detail)·계산서의 급여/비급여 구분 컬럼(본인부담금·공단부담금·전액본인부담·비급여)이
 * "신규출력 시 비어있고 2번 차트 저장 서류 재출력 시에만 표시"되던 조건부 버그 수정 검증.
 *
 * RC(가설 A · 무스키마): 급여 분류(getTaxClass)와 본인/공단 split(computeFootBilling copaymentTotal)의
 *   유일 소스가 customers.insurance_grade 였다. 신규 방문에서는 접수 시점에 grade 가 아직 null
 *   (고객이 InsuranceGradeSelect 로 명시 입력 전)이라 → getTaxClass(svc, null) + copayRate=null 로
 *   급여 분류/본인부담 split 이 붕괴 → 급여구분 컬럼 0/공란. 2번 차트에서 등급 입력 후 재출력하면
 *   grade 가 채워져 정상 표시되던 조건부 버그(김주연 총괄 U0ATDB587PV / #foot C0ATE5P6JTH).
 *
 * 해소(AC-2 무재산정·무날조): loadEffectiveInsuranceGrade — live customers.insurance_grade 가 null 이면
 *   이 방문 service_charges 에 이미 영속된 customer_grade_at_charge(급여 계산 당시 실제 적용 등급)를 폴백.
 *   저장된 사실값이므로 임의 등급 날조가 아니며, 신규출력·재출력이 동일 저장 등급으로 수렴한다(AC-3).
 *
 * 본 spec 은 급여구분이 '등급 값'에 어떻게 좌우되는지(버그 메커니즘)와, 복원된 저장 등급이
 *   재출력과 동일 산출로 수렴함을 순수 산출 경로(computeFootBilling → buildFootBillDetailItems →
 *   buildBillDetailItemsHtml)로 직접 단언한다. loadEffectiveInsuranceGrade 의 DB 폴백 선택은
 *   AC-6 실브라우저 dual-path QA(supervisor)에서 최종 확인.
 *
 * 실행: npx playwright test T-20260706-foot-DOCPRINT-FEEBREAKDOWN-INSURANCE-BLANK.spec.ts
 */

import { test, expect } from '@playwright/test';
import {
  computeFootBilling,
  buildFootBillDetailItems,
  COVERED_GRADES,
  type FootBillingItem,
  type BillingService,
} from '../../src/lib/footBilling';
import { buildBillDetailItemsHtml } from '../../src/lib/htmlFormTemplates';

const svc = (over: Partial<BillingService> & { id: string; name: string }): BillingService => ({
  service_code: null, hira_code: null, vat_type: 'none',
  is_insurance_covered: false, category_label: null, price: 0, ...over,
});

// 급여(진찰료 AA254 13,370, is_insurance_covered=true) + 비급여(레이저 350,000) 혼합 방문.
const MIXED_VISIT: FootBillingItem[] = [
  { service: svc({ id: 'c1', name: '재진진찰료-의원', service_code: 'AA254', hira_code: 'AA254', is_insurance_covered: true, category_label: '기본', price: 13370 }), qty: 1, unitPrice: 13370 },
  { service: svc({ id: 's1', name: '가열성 진균증 레이저 치료', service_code: 'SZ035', is_insurance_covered: false, category_label: '풋케어', price: 350000 }), qty: 1, unitPrice: 350000 },
];

// hira_code 로만 급여인 항목(is_insurance_covered=false, 등급 필요) — null grade 오분류 취약 케이스.
const HIRA_ONLY_COVERED: FootBillingItem[] = [
  { service: svc({ id: 'k1', name: '일반진균검사-KOH도말', service_code: 'D620300HZ', hira_code: 'D620300HZ', is_insurance_covered: false, category_label: '검사', price: 10540 }), qty: 1, unitPrice: 10540 },
];

test.describe('T-20260706 급여구분 = 등급 소스에 좌우 (버그 메커니즘)', () => {
  test('grade=null → 본인=급여전액/공단=0 (T-20260707-RECUR 총괄 확정 스펙으로 역전)', () => {
    // ⚠ T-20260707-foot-DOCPRINT-INSURANCE-SPLIT-RECUR 총괄 확정 스펙(slack ts 1783974675.205029)으로
    //   본 predecessor 의 grade-null 동작을 역전: 과거엔 copaymentTotal=0(본인0/공단=급여전액)이었으나
    //   확정 스펙 = 본인부담금 = 급여 진료비 전액, 공단부담금 = 0, 공란 금지.
    const fbNull = computeFootBilling(MIXED_VISIT, null);
    // 급여 항목(is_insurance_covered=true)은 급여로 분류 유지. copayRate=null → 본인 전액 폴백.
    expect(fbNull.copaymentTotal).toBe(13370);                  // 본인 = 급여 전액
    expect(fbNull.liveBillingValues.insuranceCovered).toBe(0);   // 공단 = 0

    const itemsNull = buildFootBillDetailItems(fbNull.pricingItems, '2026-06-09', {
      insuranceGrade: null, copaymentTotal: fbNull.copaymentTotal,
    });
    const consultNull = itemsNull.find((i) => i.code === 'AA254')!;
    expect(consultNull.copayment_amount).toBe(13370);           // 본인 = 급여 전액(공란 아님)
    expect(consultNull.amount - (consultNull.copayment_amount ?? 0)).toBe(0); // 공단 = 0
  });

  test('BUG 재현: hira_code-전용 급여 항목은 grade=null 이면 비급여로 오분류', () => {
    const fbNull = computeFootBilling(HIRA_ONLY_COVERED, null);
    // 등급 없으면 getTaxClass 가 급여로 못 올림 → 비급여로 오분류(coveredTotal=0).
    expect(fbNull.coveredTotal).toBe(0);
    expect(fbNull.nonCoveredTotal).toBe(10540);

    // 복원된 저장 등급(general)이면 정상 급여 분류.
    const fbGrade = computeFootBilling(HIRA_ONLY_COVERED, 'general');
    expect(fbGrade.coveredTotal).toBe(10540);
    expect(fbGrade.nonCoveredTotal).toBe(0);
  });

  test('FIX: 복원된 저장 등급(general) 이면 급여 본인/공단 정상 채움 (신규출력=재출력 수렴)', () => {
    const fb = computeFootBilling(MIXED_VISIT, 'general');
    expect(fb.coveredTotal).toBe(13370);
    expect(fb.copaymentTotal).toBe(4000); // floor(13370*0.3/100)*100 (FLOOR canon, T-20260715 / copayCalc.ts L162)

    const items = buildFootBillDetailItems(fb.pricingItems, '2026-06-09', {
      insuranceGrade: 'general', copaymentTotal: fb.copaymentTotal,
    });
    const consult = items.find((i) => i.code === 'AA254')!;
    expect(consult.is_insurance_covered).toBe(true);
    expect(consult.copayment_amount).toBe(4000); // 본인부담금 (FLOOR)
    const total = consult.amount * (consult.count ?? 1) * (consult.days ?? 1);
    expect(total - (consult.copayment_amount ?? 0)).toBe(9370); // 공단부담금 = 13,370 - 4,000(FLOOR)

    const html = buildBillDetailItemsHtml(items);
    // AC-1: 급여구분 실제 숫자 렌더(공란 아님)
    expect(html).toContain('4,000');   // 본인부담금 (FLOOR)
    expect(html).toContain('9,370');   // 공단부담금 (FLOOR)
    expect(html).toContain('350,000'); // 비급여 컬럼 전액
  });

  test('AC-3 수렴: null-grade 산출 ≠ 복원-grade 산출, 복원-grade = 재출력 기준값', () => {
    const htmlNull = buildBillDetailItemsHtml(
      buildFootBillDetailItems(
        computeFootBilling(MIXED_VISIT, null).pricingItems, '2026-06-09',
        { insuranceGrade: null, copaymentTotal: computeFootBilling(MIXED_VISIT, null).copaymentTotal },
      ),
    );
    const htmlGrade = buildBillDetailItemsHtml(
      buildFootBillDetailItems(
        computeFootBilling(MIXED_VISIT, 'general').pricingItems, '2026-06-09',
        { insuranceGrade: 'general', copaymentTotal: computeFootBilling(MIXED_VISIT, 'general').copaymentTotal },
      ),
    );
    // 버그(null) vs 정상(복원 등급) 출력이 실제로 달라야 함 = 폴백이 결과를 바꾼다는 증거.
    expect(htmlNull).not.toBe(htmlGrade);
    // 복원 등급 출력에만 급여 본인/공단 split(9,370) 존재. (FLOOR canon)
    expect(htmlGrade).toContain('9,370');
    expect(htmlNull).not.toContain('9,370');
  });

  test('AC-2 무날조: 복원 등급은 COVERED_GRADES 유효값만 (무보험 방문은 폴백 대상 아님)', () => {
    // loadEffectiveInsuranceGrade 폴백 게이트 정책 단언: 유효 covered 등급만 채택.
    expect(COVERED_GRADES.has('general')).toBe(true);
    // 'manual'(handleAddService 비급여 직접추가 등)은 covered 등급이 아니므로 폴백 미채택.
    expect(COVERED_GRADES.has('manual' as never)).toBe(false);
  });
});
