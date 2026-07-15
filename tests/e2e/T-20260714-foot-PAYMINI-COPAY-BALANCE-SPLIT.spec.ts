/**
 * E2E Spec — T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT (REOPEN, RC-hardened)
 *
 * 현장 P0(김주연 총괄): 급여환자 수납 시 결제 미니창(PaymentMiniWindow) 수납잔액이 공단부담금까지
 *   합산돼 환자에게 과청구되던 문제. 배포+사내 QA PASS 후에도 시크릿 브라우저에서 재현(자부담 8,900 기대
 *   vs 공단 포함 표시). 현장 수기 등록 지속 = 운영 중단 수준.
 *
 * ── RC (E2E PASS ↔ 현장 FAIL divergence) ──────────────────────────────────────
 *   Part1/2 는 수납잔액을 SSOT computeFootBilling(items, grade) 로 통일했으나, 그 함수의 grade=null
 *   폴백은 **서류출력용 DOCPRINT-RECUR** 규칙(본인=급여전액/공단=0)이다. 이를 수납 grain 에 그대로
 *   재사용하면 등급 미상 급여 방문에서 payableTotal = coveredTotal(본인전액) + nonCovered = 총 진료비
 *   = **공단 포함**. 라이브 고객 89%(301/338)가 insurance_grade=null → 사실상 전 급여 방문이 공단 포함.
 *   과거 spec 은 grade=null → payable=총진료비 를 "정답"으로 단언해 **버그를 코드화**했다(그래서 PASS).
 *   E2E 는 grade=general 시나리오 위주 → PASS, 현장은 실 급여환자(grade=null) → FAIL.
 *
 * ── 수정(REOPEN) ──────────────────────────────────────────────────────────────
 *   수납 grain 은 computeFootBilling(items, grade, { unknownGradeCopay: 'general_default' }) 사용.
 *   등급 미상 급여 방문의 본인부담을 외래 급여 기본률 general(30%)로 산정 → grade=general/null 모두
 *   자부담 8,900(현장 기대) 로 수렴. 서류출력(default 'covered_full')은 DOCPRINT-RECUR 그대로 — 회귀 0.
 *
 *   수납잔액(환자 실수납, payments 기록) = 급여 본인부담금 + 비급여 전액. 공단부담금 제외.
 *   PMW: const payBilling = computeFootBilling(items, grade, { unknownGradeCopay: 'general_default' })
 *        const payableTotal = payBilling.copaymentTotal + nonCoveredTotal
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
 * PMW 수납 grain(payableTotal)과 1:1 동일한 순수 파생. ★ opts.unknownGradeCopay='general_default'.
 *   src/components/PaymentMiniWindow.tsx:
 *     const payBilling = computeFootBilling(items, grade, { unknownGradeCopay: 'general_default' })
 *     const payableTotal = payBilling.copaymentTotal + nonCoveredTotal
 *   (nonCoveredTotal 은 등급 무관 동일 → footBilling.nonCoveredTotal 재사용)
 */
function pmwPayableTotal(items: FootBillingItem[], grade: Parameters<typeof computeFootBilling>[1]): number {
  const pay = computeFootBilling(items, grade, { unknownGradeCopay: 'general_default' });
  return pay.copaymentTotal + pay.nonCoveredTotal;
}

/** PMW 공단부담액(명세) 라인 = payBilling.liveBillingValues.insuranceCovered (수납 grain, 표시 정합). */
function pmwInsuranceCovered(items: FootBillingItem[], grade: Parameters<typeof computeFootBilling>[1]): number {
  return computeFootBilling(items, grade, { unknownGradeCopay: 'general_default' }).liveBillingValues.insuranceCovered;
}

/** 급여 30,000(hira_code 보유) + 비급여 5,000 혼합 방문 — 티켓 예시 재현. */
const MIXED_VISIT: FootBillingItem[] = [
  { service: svc({ id: 'g1', name: '급여 시술', service_code: 'AA100', hira_code: 'AA100', is_insurance_covered: true, category_label: '기본', price: 30000 }), qty: 1, unitPrice: 30000 },
  { service: svc({ id: 'n1', name: '비급여 레이저', service_code: 'SZ035', is_insurance_covered: false, category_label: '풋케어', price: 5000 }), qty: 1, unitPrice: 5000 },
];

/**
 * ★ 실 현장 데이터 재현 (RC 재발 방지의 핵심): 초진진찰료-의원 18,840 + 일반진균검사-KOH 10,540.
 *   둘 다 is_insurance_covered=true, hira_code=NULL (라이브 급여 서비스 실제 형태). 급여 합 29,380.
 *   general 30% → ceil(29380*0.3/100)*100 = 8,900 (총괄 기대값). 비급여 0.
 *   현장 급여환자 대다수가 insurance_grade=null → grade=null 도 동일하게 8,900 이어야 한다.
 */
const FIELD_COVERED_VISIT: FootBillingItem[] = [
  { service: svc({ id: 'f-chin', name: '초진진찰료-의원', is_insurance_covered: true, category_label: '기본', vat_type: 'none', price: 18840 }), qty: 1, unitPrice: 18840 },
  { service: svc({ id: 'f-koh', name: '일반진균검사-KOH도말-조갑조직', is_insurance_covered: true, category_label: '검사', vat_type: 'none', price: 10540 }), qty: 1, unitPrice: 10540 },
];

test.describe('T-20260714 REOPEN — 수납잔액 = 본인부담금(등급미상=30%) + 비급여 (공단부담금 제외)', () => {
  test('현장 재현: 급여 29,380(초진+KOH), grade=general → 수납잔액 8,900 (공단 20,480 제외)', () => {
    const pay = computeFootBilling(FIELD_COVERED_VISIT, 'general', { unknownGradeCopay: 'general_default' });
    expect(pay.coveredTotal).toBe(29380);
    expect(pay.copaymentTotal).toBe(8900);       // ceil(29380*0.3/100)*100
    expect(pay.liveBillingValues.insuranceCovered).toBe(20480); // 공단부담액(명세)
    expect(pay.nonCoveredTotal).toBe(0);
    expect(pmwPayableTotal(FIELD_COVERED_VISIT, 'general')).toBe(8900);
    // ★ 수납잔액 ≠ 총 진료비(공단 미포함 구조 증명).
    expect(pmwPayableTotal(FIELD_COVERED_VISIT, 'general')).not.toBe(pay.grandTotal);
  });

  test('★ RC 재발 방지: 급여 29,380, grade=null(고객 89% 경로) → 수납잔액 여전히 8,900 (공단 포함 금지)', () => {
    // 과거 버그: grade=null → DOCPRINT-RECUR(본인=전액) 폴백 → payable=29,380(공단 포함) = 현장 FAIL.
    // 수정 후: unknownGradeCopay='general_default' → 30% 본인부담 → 8,900.
    const payable = pmwPayableTotal(FIELD_COVERED_VISIT, null);
    expect(payable).toBe(8900);
    expect(pmwInsuranceCovered(FIELD_COVERED_VISIT, null)).toBe(20480); // 공단부담액도 grade=general 과 동일 수렴
    // 현장 FAIL 값(공단 포함 전액)과 명시적으로 달라야 한다.
    const buggyFullInclNhis = computeFootBilling(FIELD_COVERED_VISIT, null).grandTotal; // = 29,380 (default 폴백)
    expect(buggyFullInclNhis).toBe(29380);
    expect(payable).not.toBe(buggyFullInclNhis);
  });

  test('시나리오1 급여환자(general 30%) + 비급여 혼합: payableTotal = 본인 9,000 + 비급여 5,000 = 14,000', () => {
    const pay = computeFootBilling(MIXED_VISIT, 'general', { unknownGradeCopay: 'general_default' });
    expect(pay.coveredTotal).toBe(30000);
    expect(pay.copaymentTotal).toBe(9000);        // ceil(30000*0.3/100)*100
    expect(pay.liveBillingValues.insuranceCovered).toBe(21000); // 공단부담금
    expect(pay.nonCoveredTotal).toBe(5000);
    expect(pay.grandTotal).toBe(35000);

    const payable = pmwPayableTotal(MIXED_VISIT, 'general');
    expect(payable).toBe(14000);
    expect(payable).not.toBe(pay.grandTotal);
    expect(pay.grandTotal - payable).toBe(pay.liveBillingValues.insuranceCovered); // 차이 = 공단부담금
  });

  test('시나리오2 grade=null 혼합(현장 대다수): payableTotal = 본인 9,000(30%) + 비급여 5,000 = 14,000 (공단 21,000 제외)', () => {
    const payable = pmwPayableTotal(MIXED_VISIT, null);
    expect(payable).toBe(14000);
    expect(pmwInsuranceCovered(MIXED_VISIT, null)).toBe(21000);
    // 회귀 방지: 총 진료비(35,000, 공단 포함) 로 절대 표시되면 안 됨(= 현장 P0 재발).
    expect(payable).not.toBe(35000);
  });

  test('시나리오3 비급여만(무파괴 회귀): 급여 0 → payableTotal = 비급여 전액 = 총 진료비(변화 없음)', () => {
    const NONCOVERED_ONLY: FootBillingItem[] = [
      { service: svc({ id: 'n1', name: '비급여 레이저', service_code: 'SZ035', is_insurance_covered: false, category_label: '풋케어', price: 5000 }), qty: 1, unitPrice: 5000 },
    ];
    const fb = computeFootBilling(NONCOVERED_ONLY, 'general', { unknownGradeCopay: 'general_default' });
    expect(fb.coveredTotal).toBe(0);
    expect(fb.copaymentTotal).toBe(0);
    expect(fb.nonCoveredTotal).toBe(5000);
    const payable = pmwPayableTotal(NONCOVERED_ONLY, 'general');
    expect(payable).toBe(5000);
    expect(payable).toBe(fb.grandTotal); // 급여 없으면 공단분도 없어 수납잔액 = 총 진료비(회귀 0)
    // grade=null 도 동일(비급여는 등급 무관).
    expect(pmwPayableTotal(NONCOVERED_ONLY, null)).toBe(5000);
  });

  test('회귀가드: 유효 등급(general)은 100원 절상 기존 산식 유지 — general_default 지정 무영향', () => {
    // copayRate!==null 경로는 opts 와 무관하게 동일 산식 → general 지정/미지정 동일값.
    expect(computeFootBilling(MIXED_VISIT, 'general').copaymentTotal).toBe(9000);
    expect(computeFootBilling(MIXED_VISIT, 'general', { unknownGradeCopay: 'general_default' }).copaymentTotal).toBe(9000);
  });
});

test.describe('T-20260714 REOPEN — 서류출력 경로(default) DOCPRINT-RECUR 불변 (회귀 0)', () => {
  test('default(covered_full): grade=null → 본인=급여전액/공단=0 유지 (서류출력·service_charges 폴백 무회귀)', () => {
    // computeFootBilling(items, null) — opts 미지정 = 서류출력 경로. DOCPRINT-RECUR(총괄확정) 보존.
    const doc = computeFootBilling(MIXED_VISIT, null);
    expect(doc.coveredTotal).toBe(30000);
    expect(doc.copaymentTotal).toBe(30000);                    // 본인 = 급여전액 (DOCPRINT-RECUR)
    expect(doc.liveBillingValues.insuranceCovered).toBe(0);    // 공단 = 0
  });

  test('default vs 수납 grain 분리 증명: 동일 급여방문(grade=null)에서 문서=전액 / 수납=30%', () => {
    const docCopay = computeFootBilling(FIELD_COVERED_VISIT, null).copaymentTotal;                    // 29,380 (문서)
    const payCopay = computeFootBilling(FIELD_COVERED_VISIT, null, { unknownGradeCopay: 'general_default' }).copaymentTotal; // 8,900 (수납)
    expect(docCopay).toBe(29380);
    expect(payCopay).toBe(8900);
    expect(docCopay).not.toBe(payCopay); // 두 grain 이 의도적으로 분리됨(서류 회귀 없이 수납만 수정)
  });

  test('유효 등급(general)은 문서/수납 grain 동일 (분기는 등급 미상에서만 발생)', () => {
    expect(computeFootBilling(FIELD_COVERED_VISIT, 'general').copaymentTotal).toBe(8900);
    expect(computeFootBilling(FIELD_COVERED_VISIT, 'general', { unknownGradeCopay: 'general_default' }).copaymentTotal).toBe(8900);
  });
});

test.describe('T-20260714 REOPEN — 공단부담액(명세) 라인 & grain 배타 불변식', () => {
  test('수납잔액 + 공단부담액(명세) = 총 진료비 (grade=general, 배타·중복합산 0)', () => {
    const fb = computeFootBilling(FIELD_COVERED_VISIT, 'general', { unknownGradeCopay: 'general_default' });
    expect(pmwPayableTotal(FIELD_COVERED_VISIT, 'general') + pmwInsuranceCovered(FIELD_COVERED_VISIT, 'general')).toBe(fb.grandTotal);
  });

  test('수납잔액 + 공단부담액(명세) = 총 진료비 (grade=null, 배타 불변식 — 공단이 0 으로 붕괴하지 않음)', () => {
    const grand = computeFootBilling(FIELD_COVERED_VISIT, null).grandTotal; // 29,380
    expect(pmwPayableTotal(FIELD_COVERED_VISIT, null) + pmwInsuranceCovered(FIELD_COVERED_VISIT, null)).toBe(grand);
    expect(pmwInsuranceCovered(FIELD_COVERED_VISIT, null)).toBeGreaterThan(0); // 자부담 8,900 인데 공단 0 인 모순 금지
  });

  test('비급여만: 공단부담액(명세) = 0 → 라인 숨김(insCovered>0 조건)', () => {
    const NONCOVERED_ONLY: FootBillingItem[] = [
      { service: svc({ id: 'n1', name: '비급여 레이저', is_insurance_covered: false, category_label: '풋케어', price: 5000 }), qty: 1, unitPrice: 5000 },
    ];
    expect(pmwInsuranceCovered(NONCOVERED_ONLY, 'general')).toBe(0);
    expect(pmwInsuranceCovered(NONCOVERED_ONLY, null)).toBe(0);
  });
});

/**
 * REOPEN#5 (김주연 총괄, 스크린샷+직접 요구) — 세금구분 '급여' 라인 자체를 자부담(30%)으로.
 *   REOPEN#4 disambiguation: 총괄이 보는 곳은 하단 '수납잔액' 총액이 아니라 결제미니창 내
 *   '세금 구분' 내역의 '급여' 라인. 그 라인이 공단부담 포함 전체 급여액(coveredTotal, 29,380)을
 *   표시하던 것을 → 환자 자부담만(payCopaymentTotal, 8,900) + 라벨 "급여"→"급여 자부담(30%)"로.
 *
 * PMW 렌더: totalByTax 맵의 cls==='급여' 행 금액 = payCopaymentTotal(=payBilling.copaymentTotal),
 *   라벨 = `급여 자부담(${round(copayRate*100)}%)`. 공단부담(70%)은 별도 '공단부담액(명세)' 라인.
 *   → 세금구분 급여 라인 값은 SSOT copay 와 1:1, coveredTotal(전체 급여액)과 명시적으로 달라야 한다.
 */
test.describe("REOPEN#5 — 세금구분 '급여' 라인 = 급여 자부담(30%), 공단부담 제외", () => {
  /** PMW '급여' 세금구분 행에 표시되는 금액 = payBilling.copaymentTotal (수납 grain, 등급미상→30%). */
  function pmwCoveredTaxLineAmount(items: FootBillingItem[], grade: Parameters<typeof computeFootBilling>[1]): number {
    return computeFootBilling(items, grade, { unknownGradeCopay: 'general_default' }).copaymentTotal;
  }

  test('현장 재현: 급여 29,380, grade=general → 급여 라인 = 8,900 (전체 급여액 29,380 아님)', () => {
    const covered = computeFootBilling(FIELD_COVERED_VISIT, 'general').coveredTotal; // 29,380 (전체=본인+공단)
    expect(covered).toBe(29380);
    const line = pmwCoveredTaxLineAmount(FIELD_COVERED_VISIT, 'general');
    expect(line).toBe(8900);          // ★ 급여 라인 = 자부담(30%)만
    expect(line).not.toBe(covered);   // ★ 공단부담 포함 전체(29,380) 표시 금지 = 총괄 P0 재발 차단
  });

  test('★ grade=null(고객 89% 경로) → 급여 라인 여전히 8,900 (공단포함 29,380 금지)', () => {
    const line = pmwCoveredTaxLineAmount(FIELD_COVERED_VISIT, null);
    expect(line).toBe(8900);
    expect(line).not.toBe(29380);
  });

  test('세금구분 급여 라인 + 공단부담액(명세) = 전체 급여액 (배타·중복 0)', () => {
    const line = pmwCoveredTaxLineAmount(FIELD_COVERED_VISIT, 'general');
    const nhis = pmwInsuranceCovered(FIELD_COVERED_VISIT, 'general');
    expect(line + nhis).toBe(computeFootBilling(FIELD_COVERED_VISIT, 'general').coveredTotal); // 8,900 + 20,480 = 29,380
  });

  test('혼합 방문: 급여 라인 = 본인 9,000 (비급여 5,000·공단 21,000 과 무혼입)', () => {
    const line = pmwCoveredTaxLineAmount(MIXED_VISIT, 'general');
    expect(line).toBe(9000);
    expect(line).not.toBe(30000); // 전체 급여액 아님
  });

  test('비급여만: 급여 라인 = 0 (급여 항목 없음)', () => {
    const NONCOVERED_ONLY: FootBillingItem[] = [
      { service: svc({ id: 'n1', name: '비급여 레이저', is_insurance_covered: false, category_label: '풋케어', price: 5000 }), qty: 1, unitPrice: 5000 },
    ];
    expect(pmwCoveredTaxLineAmount(NONCOVERED_ONLY, 'general')).toBe(0);
  });
});
