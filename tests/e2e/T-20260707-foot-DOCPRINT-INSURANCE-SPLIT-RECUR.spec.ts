/**
 * E2E Spec — T-20260707-foot-DOCPRINT-INSURANCE-SPLIT-RECUR
 *
 * 재발(RECUR): predecessor T-20260706-DOCPRINT-FEEBREAKDOWN-INSURANCE-BLANK 배포(loadEffectiveInsuranceGrade
 *   폴백) 후 ~22h 만에 동일 증상(서류 발행 급여/비급여 구분 미삽입) 재보고(김주연 총괄 U0ATDB587PV / #foot).
 *
 * RC(확정 · 코드진단 · 무스키마): predecessor 는 "grade 소스"를 고쳤으나, 결제창(PATH-4, PaymentMiniWindow)의
 *   진료비세부산정내역(bill_detail) 빌드가 **공유 SSOT(buildFootBillDetailItems)를 쓰지 않는** inline 빌더였다.
 *   그 inline 빌더는 (a) 급여/비급여를 svc.is_insurance_covered 만으로 분류(등급+hira_code 급여 미반영) 하고
 *   (b) per-item 본인부담금(copayment_amount) 을 아예 주입하지 않아 → buildBillDetailItemsHtml 이
 *   본인부담금/공단부담금 컬럼을 '0' 으로 렌더 → "급여구분이 항목에 삽입되지 않음". DocumentPrintPanel
 *   (PATH-1/2/3)은 이미 SSOT 를 써서 정상이었으므로 PATH-4 만의 잔존 분기였다.
 *
 * 해소(AC-2/4/5 무재산정·무날조·무신설): PMW 도 DocumentPrintPanel 과 동일한 SSOT
 *   buildFootBillDetailItems(pricingItems, date, { insuranceGrade, copaymentTotal }) 로 통일.
 *   getTaxClass(등급반영) 분류 + copaymentTotal 비례배분(잔차보정)으로 본인/공단 컬럼을 채운다.
 *   신규 프린트 경로 신설 없음(기존 SSOT 재사용), 화면 산출값 그대로 사용.
 *
 * 본 spec 은 (OLD inline 빌더) vs (NEW SSOT 빌더) 산출을 순수 경로로 직접 대비해 PATH-4 버그 메커니즘과
 *   수정 후 급여구분 삽입을 단언한다. 실브라우저 인쇄 미리보기 3-시나리오 육안 대조는 AC-3(supervisor QA).
 *
 * 실행: npx playwright test T-20260707-foot-DOCPRINT-INSURANCE-SPLIT-RECUR.spec.ts
 */

import { test, expect } from '@playwright/test';
import {
  computeFootBilling,
  buildFootBillDetailItems,
  fillBillItemCopayment,
  type FootBillingItem,
  type BillingService,
} from '../../src/lib/footBilling';
import { buildBillDetailItemsHtml } from '../../src/lib/htmlFormTemplates';

const svc = (over: Partial<BillingService> & { id: string; name: string }): BillingService => ({
  service_code: null, hira_code: null, vat_type: 'none',
  is_insurance_covered: false, category_label: null, price: 0, ...over,
});

// 급여(재진진찰료 AA254 13,370, is_insurance_covered=true) + 비급여(레이저 350,000) 혼합 방문.
const MIXED_VISIT: FootBillingItem[] = [
  { service: svc({ id: 'c1', name: '재진진찰료-의원', service_code: 'AA254', hira_code: 'AA254', is_insurance_covered: true, category_label: '기본', price: 13370 }), qty: 1, unitPrice: 13370 },
  { service: svc({ id: 's1', name: '가열성 진균증 레이저 치료', service_code: 'SZ035', is_insurance_covered: false, category_label: '풋케어', price: 350000 }), qty: 1, unitPrice: 350000 },
];

/**
 * OLD: PMW handleDocPrint/handleDocAndSettle 이 쓰던 inline 빌더(RC). 등급·copayInfo 미반영.
 *   (수정 전 코드 그대로 재현 — is_insurance_covered 분류, copayment_amount 미주입.)
 */
function buildLegacyPmwItems(items: FootBillingItem[], visitDate: string) {
  return items.map(({ service, qty, unitPrice }) => ({
    category: service.is_insurance_covered ? '이학요법료' : '기타',
    date: visitDate,
    code: service.service_code ?? '',
    name: service.name,
    amount: unitPrice,
    count: qty,
    days: 1,
    is_insurance_covered: service.is_insurance_covered ?? false,
    // copayment_amount 미주입 ← 버그: 본인/공단 split 소스 부재
  }));
}

/**
 * NEW: 수정 후 PMW buildPmwBillDetailItems = DocumentPrintPanel 과 동일 SSOT.
 */
function buildFixedPmwItems(items: FootBillingItem[], grade: Parameters<typeof computeFootBilling>[1], visitDate: string) {
  const fb = computeFootBilling(items, grade);
  return buildFootBillDetailItems(fb.pricingItems, visitDate, {
    insuranceGrade: grade,
    copaymentTotal: fb.copaymentTotal,
  });
}

test.describe('T-20260707 PATH-4(결제창) bill_detail 급여구분 = SSOT 미사용이 RC', () => {
  test('시나리오1 BUG 재현: OLD inline 빌더는 급여 항목 본인/공단 split 미삽입(공란=0)', () => {
    const legacy = buildLegacyPmwItems(MIXED_VISIT, '2026-07-07');
    const consult = legacy.find((i) => i.code === 'AA254')! as { copayment_amount?: number };
    // inline 빌더는 copayment_amount 자체를 만들지 않는다 → 본인/공단 split 소스 부재.
    expect(consult.copayment_amount).toBeUndefined();

    const html = buildBillDetailItemsHtml(legacy);
    // buildBillDetailItemsHtml: copayment_amount==null → 본인부담금/공단부담금 '0'. 급여구분 미삽입.
    expect(html).not.toContain('4,100'); // 본인부담금 부재
    expect(html).not.toContain('9,270'); // 공단부담금 부재
  });

  test('시나리오1 FIX: NEW SSOT 빌더(등급 general)는 본인/공단 정상 삽입', () => {
    const items = buildFixedPmwItems(MIXED_VISIT, 'general', '2026-07-07');
    const consult = items.find((i) => i.code === 'AA254')!;
    expect(consult.is_insurance_covered).toBe(true);
    expect(consult.copayment_amount).toBe(4000); // FLOOR(13370*0.3/100)*100 본인부담금 (구 CEIL 4100 정정 — T-20260719 LEGACYRENDER-FIXTURE-DBISO: copayCalc v1.5 CEIL→FLOOR 미러)
    const total = consult.amount * (consult.count ?? 1) * (consult.days ?? 1);
    expect(total - (consult.copayment_amount ?? 0)).toBe(9370); // 공단부담금 (13370-4000, 구 9270 정정)

    const html = buildBillDetailItemsHtml(items);
    expect(html).toContain('4,000');   // 본인부담금 삽입
    expect(html).toContain('9,370');   // 공단부담금 삽입
    expect(html).toContain('350,000'); // 비급여 컬럼 전액
  });

  test('시나리오2 대조: OLD vs NEW 출력이 실제로 달라야 함(=SSOT 통일이 결과를 바꾼다는 증거)', () => {
    const htmlLegacy = buildBillDetailItemsHtml(buildLegacyPmwItems(MIXED_VISIT, '2026-07-07'));
    const htmlFixed = buildBillDetailItemsHtml(buildFixedPmwItems(MIXED_VISIT, 'general', '2026-07-07'));
    expect(htmlLegacy).not.toBe(htmlFixed);
    // 급여 본인/공단 split 은 SSOT 경로에만 존재.
    expect(htmlFixed).toContain('9,370'); // 공단부담금 (FLOOR 정정, 구 9270)
    expect(htmlLegacy).not.toContain('9,370');
  });

  test('시나리오3 회귀가드: NEW SSOT 는 DocumentPrintPanel(PATH-1/2/3)과 1:1 동일 산출(재출력 정합)', () => {
    // DocumentPrintPanel fbBatch 경로(L911)와 완전히 동일한 호출 → 동일 items_html 이어야 재출력 정합(회귀 0).
    const grade = 'general' as const;
    const fb = computeFootBilling(MIXED_VISIT, grade);
    const dpItems = buildFootBillDetailItems(fb.pricingItems, '2026-07-07', {
      insuranceGrade: grade, copaymentTotal: fb.copaymentTotal,
    });
    const pmwItems = buildFixedPmwItems(MIXED_VISIT, grade, '2026-07-07');
    expect(buildBillDetailItemsHtml(pmwItems)).toBe(buildBillDetailItemsHtml(dpItems));
  });

  test('무파괴: 등급 null 이어도 급여/비급여 분류(is_insurance_covered)는 항상 삽입', () => {
    // 등급 폴백도 실패한 무보험/미입력 방문이라도 최소한 급여/비급여 구분은 유지(비급여로 붕괴 방지).
    const items = buildFixedPmwItems(MIXED_VISIT, null, '2026-07-07');
    const consult = items.find((i) => i.code === 'AA254')!;
    // is_insurance_covered=true 항목은 등급 null 이어도 급여 분류 유지(getTaxClass svc.is_insurance_covered 폴백).
    expect(consult.is_insurance_covered).toBe(true);
    const laser = items.find((i) => i.code === 'SZ035')!;
    expect(laser.is_insurance_covered).toBe(false);
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * T-20260707-foot-DOCPRINT-INSURANCE-SPLIT-RECUR (총괄 확정 스펙, slack ts 1783974675.205029)
 * AC-7 null-grade fallback 회귀 케이스.
 *
 * 확정 스펙: 건보 조회 실패 / insurance_grade=null / coverage_rate(copayRate) null 방문 →
 *   본인부담금 = 급여 진료비 전액, 공단부담금 = 0, 공란(null/undefined) 절대 금지.
 *   (과거 동작 = 본인0/공단=급여전액 을 의도적으로 역전.)
 * ─────────────────────────────────────────────────────────────────────────────
 */
test.describe('T-20260707 null-grade fallback: 본인=급여전액 / 공단=0 (총괄 확정)', () => {
  test('AC-8(1) computeFootBilling: grade null → copayment=급여전액, insuranceCovered(공단)=0', () => {
    const fb = computeFootBilling(MIXED_VISIT, null);
    // 급여전액 = 재진진찰료 13,370 (레이저는 비급여). copayRate null → 본인 전액 폴백.
    expect(fb.coveredTotal).toBe(13370);
    expect(fb.copaymentTotal).toBe(13370);                        // 본인부담금 = 급여 진료비 전액
    expect(fb.liveBillingValues.copayment).toBe(13370);
    expect(fb.liveBillingValues.insuranceCovered).toBe(0);         // 공단부담금 = 0
    expect(fb.liveBillingValues.nonCovered).toBe(350000);          // 비급여 전액(불변)
  });

  test('AC-8(1) 세부산정내역 per-item + HTML: 급여 항목 본인=전액/공단=0, 공란 없음', () => {
    const items = buildFixedPmwItems(MIXED_VISIT, null, '2026-07-07');
    const consult = items.find((i) => i.code === 'AA254')!;
    expect(consult.is_insurance_covered).toBe(true);
    expect(consult.copayment_amount).toBe(13370);                  // 본인 = 급여 전액(공란 아님)
    const total = consult.amount * (consult.count ?? 1) * (consult.days ?? 1);
    expect(total - (consult.copayment_amount ?? 0)).toBe(0);       // 공단 = 0

    const html = buildBillDetailItemsHtml(items);
    expect(html).toContain('13,370');  // 본인부담금 = 급여전액 삽입(공란 금지)
    expect(html).toContain('350,000'); // 비급여 전액
  });

  test('AC-8(3) 계산서·영수증 정합: 동일 SSOT copaymentTotal 로 요약행 본인=전액/공단=0', () => {
    // DocumentPrintPanel 이 bindValues 에 넣는 값과 동일 소스(fb.liveBillingValues / fb.copaymentTotal).
    const fb = computeFootBilling(MIXED_VISIT, null);
    // 요약행(계산서·영수증 공통): 본인부담금=급여전액, 공단부담금=0.
    expect(fb.copaymentTotal).toBe(13370);
    expect(fb.liveBillingValues.insuranceCovered).toBe(0);
    // 세부산정내역 per-item 합계와 요약행이 정확히 일치(구조적 정합).
    const items = buildFootBillDetailItems(fb.pricingItems, '2026-07-07', {
      insuranceGrade: null, copaymentTotal: fb.copaymentTotal,
    });
    const sumCopay = items.filter((i) => i.is_insurance_covered)
      .reduce((s, i) => s + (i.copayment_amount ?? 0), 0);
    expect(sumCopay).toBe(fb.copaymentTotal);
  });

  test('AC-8 Path A(service_charges 직결) fillBillItemCopayment: grade null → 본인=전액/공단=0', () => {
    // check_in_services 미기록 구 데이터 폴백 경로. DB copayment_amount 부재(null) 케이스.
    const billItems = [
      { amount: 13370, count: 1, days: 1, is_insurance_covered: true }, // 급여
      { amount: 350000, count: 1, days: 1, is_insurance_covered: false }, // 비급여
    ] as Array<{ amount: number; count?: number; days?: number; is_insurance_covered: boolean; copayment_amount?: number }>;
    fillBillItemCopayment(billItems, null); // grade null → 본인 전액 폴백(과거엔 early-return 미개입)
    expect(billItems[0].copayment_amount).toBe(13370);              // 본인 = 급여 전액
    expect(billItems[0].amount - (billItems[0].copayment_amount ?? 0)).toBe(0); // 공단 = 0
    expect(billItems[1].copayment_amount).toBeUndefined();          // 비급여는 미개입
  });

  test('AC-8(2) 회귀가드: grade 실재(general) 방문은 기존 split 유지(본인 4,000 / 공단 9,370)', () => {
    const fb = computeFootBilling(MIXED_VISIT, 'general');
    expect(fb.copaymentTotal).toBe(4000);                          // FLOOR(13370*0.3/100)*100 (구 CEIL 4100 정정)
    expect(fb.liveBillingValues.insuranceCovered).toBe(9370);      // 공단 정상 분리(13370-4000, 구 9270 정정)
  });

  test('AC-8 Path A 회귀가드: grade 실재는 100원 미만 절사(FLOOR) 산식 유지', () => {
    const billItems = [
      { amount: 13370, count: 1, days: 1, is_insurance_covered: true },
    ] as Array<{ amount: number; count?: number; days?: number; is_insurance_covered: boolean; copayment_amount?: number }>;
    fillBillItemCopayment(billItems, 'general');
    expect(billItems[0].copayment_amount).toBe(4000);              // 본인 4,000 (FLOOR, 구 CEIL 4100 정정)
  });

  test('AC-4 무날조: DB 권위(copayment_amount 기존값) 있으면 grade null 이어도 미개입', () => {
    const billItems = [
      { amount: 13370, count: 1, days: 1, is_insurance_covered: true, copayment_amount: 5000 }, // DB 권위
    ] as Array<{ amount: number; count?: number; days?: number; is_insurance_covered: boolean; copayment_amount?: number }>;
    fillBillItemCopayment(billItems, null);
    expect(billItems[0].copayment_amount).toBe(5000);              // DB 값 보존(무접촉)
  });
});
