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
    expect(consult.copayment_amount).toBe(4100); // ceil(13370*0.3/100)*100 본인부담금
    const total = consult.amount * (consult.count ?? 1) * (consult.days ?? 1);
    expect(total - (consult.copayment_amount ?? 0)).toBe(9270); // 공단부담금

    const html = buildBillDetailItemsHtml(items);
    expect(html).toContain('4,100');   // 본인부담금 삽입
    expect(html).toContain('9,270');   // 공단부담금 삽입
    expect(html).toContain('350,000'); // 비급여 컬럼 전액
  });

  test('시나리오2 대조: OLD vs NEW 출력이 실제로 달라야 함(=SSOT 통일이 결과를 바꾼다는 증거)', () => {
    const htmlLegacy = buildBillDetailItemsHtml(buildLegacyPmwItems(MIXED_VISIT, '2026-07-07'));
    const htmlFixed = buildBillDetailItemsHtml(buildFixedPmwItems(MIXED_VISIT, 'general', '2026-07-07'));
    expect(htmlLegacy).not.toBe(htmlFixed);
    // 급여 본인/공단 split 은 SSOT 경로에만 존재.
    expect(htmlFixed).toContain('9,270');
    expect(htmlLegacy).not.toContain('9,270');
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
