/**
 * E2E Spec — T-20260611-foot-BILLDETAIL-CONSULTFEE-COPAY-REWORK
 *
 * 진료비 세부산정내역(bill_detail)의 라인아이템·합계 SSOT 를 check_in_services 로 통일한
 * DocumentPrintPanel 수정(단건 발행 + 일괄 출력)의 핵심 산출을 단위 검증.
 *
 * RC(현장, 김주연 총괄 U0ATDB587PV / #foot C0ATE5P6JTH, test_patient=박민석 bd814f22):
 *   service_charges(보험 copay 산출 감사로그)가 진찰료(AA154/AA254)·레이저 등 '가격 항목'을 누락한
 *   불완전 부분집합인 차트가 존재 → Path A(service_charges 직결) bill_detail 에서 진찰료 행 통째 누락 +
 *   computedTotal(service_charges 부분합=0)이 total_amount 를 0 으로 덮어 영수증과 합계 불일치.
 *   영수증(bill_receipt)은 이미 check_in_services→computeFootBilling.grandTotal 을 SSOT 로 씀
 *   (RECEIPT-LASER-MISSING) → bill_detail 도 동일 SSOT 로 통일하면 진찰료 포함 + 합계 자동 정합.
 *
 * 본 spec 은 그 SSOT 경로(computeFootBilling → buildFootBillDetailItems → buildBillDetailItemsHtml)를
 * 박민석 bd814f22 데이터 형상으로 직접 단언한다(실서버 불필요 — 수정 후 컴포넌트가 이 경로로 라우팅).
 *
 * AC:
 *  - AC-1: 진찰료(AA254 재진/AA154 초진) 행이 bill_detail 에 표기된다.
 *  - AC-2: 진찰료 포함 급여 항목에 본인부담금·공단부담금이 채워진다(공란/0 아님).
 *  - AC-3: 비급여 항목은 비급여(전액본인) 컬럼에 전액, 급여 본인/공단 컬럼은 0.
 *  - AC-4: bill_detail 항목 합계 = computeFootBilling.grandTotal(=영수증 합계 SSOT).
 *  - AC-5(회귀): 다급여 항목 per-item 본인부담금 비례배분 합계 = copaymentTotal(0cbbdc2 보존).
 *  - 상병코드(category_label='상병')는 가격 항목에서 제외.
 *
 * 실행: npx playwright test T-20260611-foot-BILLDETAIL-CONSULTFEE-COPAY-REWORK.spec.ts
 */

import { test, expect } from '@playwright/test';
import {
  computeFootBilling,
  buildFootBillDetailItems,
  type FootBillingItem,
  type BillingService,
} from '../../src/lib/footBilling';
import { buildBillDetailItemsHtml } from '../../src/lib/htmlFormTemplates';

const svc = (over: Partial<BillingService> & { id: string; name: string }): BillingService => ({
  service_code: null, hira_code: null, vat_type: 'none',
  is_insurance_covered: false, category_label: null, price: 0, ...over,
});

// 박민석 bd814f22(2026-06-09, returning, grade=general) check_in_services 형상 재현:
//   진찰료 AA254(13,370, 급여) + 레이저 SZ035(350,000, 비급여) + 상병코드 2건(0원).
const PARK_BD814F22: FootBillingItem[] = [
  { service: svc({ id: 'c1', name: '재진진찰료-의원', service_code: 'AA254', is_insurance_covered: true, category_label: '기본', price: 13370 }), qty: 1, unitPrice: 13370 },
  { service: svc({ id: 's1', name: '가열성 진균증 레이저 치료', service_code: 'SZ035', is_insurance_covered: false, category_label: '풋케어', price: 350000 }), qty: 1, unitPrice: 350000 },
  { service: svc({ id: 'd1', name: '손발톱백선', service_code: 'B351', category_label: '상병', price: 0 }), qty: 1, unitPrice: 0 },
  { service: svc({ id: 'd2', name: '발백선', service_code: 'B353', category_label: '상병', price: 0 }), qty: 1, unitPrice: 0 },
];

test.describe('bill_detail = check_in_services SSOT (진찰료 포함 + copay + 합계 정합)', () => {
  test('AC-1/2/4: 진찰료 행 표기 + 급여 본인/공단 채움 + 합계=grandTotal', () => {
    const fb = computeFootBilling(PARK_BD814F22, 'general');

    // AC-4 기준값: bill_detail 합계 = grandTotal(=영수증 SSOT)
    expect(fb.grandTotal).toBe(363370);
    // 진찰료(13,370)만 급여 → 30% 100원절상 = 4,100
    expect(fb.coveredTotal).toBe(13370);
    expect(fb.copaymentTotal).toBe(4100);

    const billItems = buildFootBillDetailItems(fb.pricingItems, '2026-06-09', {
      insuranceGrade: 'general',
      copaymentTotal: fb.copaymentTotal,
    });

    // 상병코드 제외 → 가격 항목 2건(진찰료 + 레이저)
    expect(billItems).toHaveLength(2);

    // AC-1: 진찰료 AA254 행 존재
    const consult = billItems.find((i) => i.code === 'AA254');
    expect(consult, '진찰료(AA254) 행이 bill_detail 에 표기되어야 함').toBeTruthy();
    expect(consult!.is_insurance_covered).toBe(true);

    // AC-2: 진찰료 본인부담금 채워짐(공란/0 아님), 공단부담금 = 금액 - 본인부담금
    expect(consult!.copayment_amount).toBe(4100);
    const consultTotal = consult!.amount * (consult!.count ?? 1) * (consult!.days ?? 1);
    expect(consultTotal - (consult!.copayment_amount ?? 0)).toBe(9270); // 공단부담금

    // AC-4: 항목 합계 = grandTotal
    const itemsSum = billItems.reduce((s, i) => s + i.amount * (i.count ?? 1) * (i.days ?? 1), 0);
    expect(itemsSum).toBe(fb.grandTotal);
  });

  test('AC-1/2: 렌더 HTML 에 진찰료 행 + 본인/공단 숫자 출력(공란 아님)', () => {
    const fb = computeFootBilling(PARK_BD814F22, 'general');
    const billItems = buildFootBillDetailItems(fb.pricingItems, '2026-06-09', {
      insuranceGrade: 'general', copaymentTotal: fb.copaymentTotal,
    });
    const html = buildBillDetailItemsHtml(billItems);

    expect(html).toContain('AA254');
    expect(html).toContain('재진진찰료-의원');
    // 본인부담금 4,100 / 공단부담금 9,270 가 실제 셀에 렌더됨
    expect(html).toContain('4,100');
    expect(html).toContain('9,270');
    expect(html).not.toContain('진료 항목 없음');
  });

  test('AC-3: 비급여 항목은 급여 본인/공단 0, 비급여 컬럼 전액', () => {
    const fb = computeFootBilling(PARK_BD814F22, 'general');
    const billItems = buildFootBillDetailItems(fb.pricingItems, '2026-06-09', {
      insuranceGrade: 'general', copaymentTotal: fb.copaymentTotal,
    });
    const laser = billItems.find((i) => i.code === 'SZ035');
    expect(laser).toBeTruthy();
    expect(laser!.is_insurance_covered).toBe(false);
    // 비급여 → 급여 본인부담금 미설정(렌더 시 0). 비급여 컬럼에 전액(350,000).
    expect(laser!.copayment_amount).toBeUndefined();
    const html = buildBillDetailItemsHtml([laser!]);
    expect(html).toContain('350,000'); // 비급여 컬럼 전액
  });

  test('AC-5(회귀): 다급여 항목 per-item 본인부담금 비례배분 합계 = copaymentTotal', () => {
    // 진찰료(18,840) + KOH검사(10,540) 둘 다 급여 → 배분 합계가 copaymentTotal 과 정확히 일치(0cbbdc2 보존)
    const multiCovered: FootBillingItem[] = [
      { service: svc({ id: 'c2', name: '초진진찰료-의원', service_code: 'AA154', is_insurance_covered: true, category_label: '기본', price: 18840 }), qty: 1, unitPrice: 18840 },
      { service: svc({ id: 'k1', name: '일반진균검사-KOH도말', service_code: 'D620300HZ', is_insurance_covered: true, category_label: '검사', price: 10540 }), qty: 1, unitPrice: 10540 },
      { service: svc({ id: 's2', name: '레이저', service_code: 'SZ035', is_insurance_covered: false, category_label: '풋케어', price: 300000 }), qty: 1, unitPrice: 300000 },
    ];
    const fb = computeFootBilling(multiCovered, 'general');
    expect(fb.coveredTotal).toBe(29380);
    expect(fb.copaymentTotal).toBe(8900); // ceil(29380*0.3/100)*100

    const billItems = buildFootBillDetailItems(fb.pricingItems, '2026-05-21', {
      insuranceGrade: 'general', copaymentTotal: fb.copaymentTotal,
    });
    const coveredCopaySum = billItems
      .filter((i) => i.is_insurance_covered)
      .reduce((s, i) => s + (i.copayment_amount ?? 0), 0);
    // 회귀 가드: per-item 합계 = 집계 copaymentTotal (진료비계산서 {{copayment}} 정합)
    expect(coveredCopaySum).toBe(fb.copaymentTotal);
    // 각 급여 항목 본인부담금 ≤ 항목 금액(과배분 없음)
    for (const i of billItems.filter((b) => b.is_insurance_covered)) {
      expect(i.copayment_amount ?? 0).toBeLessThanOrEqual(i.amount * (i.count ?? 1) * (i.days ?? 1));
    }
  });
});
