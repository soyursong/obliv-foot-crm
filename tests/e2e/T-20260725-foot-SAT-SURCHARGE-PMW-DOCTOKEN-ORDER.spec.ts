import { test, expect } from '@playwright/test';
import {
  detectSurchargeKind,
  computeSurcharge,
  applyNightHolidaySurcharge,
} from '../../src/lib/nightHolidaySurcharge';
import {
  applyBillReceiptNewLiveTotals,
  applyBillReceiptNewCoveredTokens,
  applyBillReceiptPaidBoxTokens,
  computeBillDetailRounding,
  checkBillReceiptPaidBoxInvariant,
} from '../../src/lib/footBilling';
import { formatAmount } from '../../src/lib/format';
import { buildSurchargeDetailRowHtml } from '../../src/lib/htmlFormTemplates';

/**
 * E2E — T-20260725-foot-SAT-SURCHARGE-PMW-DOCTOKEN-ORDER 결함②(PMW 출력토큰 가산-순서 정정)
 *
 * 배경: PMW 인쇄경로(handleDocPrint/handleDocAndSettle)가 신양식(bill_receipt_new) 출력토큰
 *   (CoveredTokens=급여 remainder / 납부박스 ⑧⑨⑩·미납 / 환자부담 10원 절사)을 **야간·공휴일·토요일
 *   가산 fold 前** 에 계산했다 → 출력 영수증에서 Σ(급여 remainder 행) ≠ 급여합계, ⑧ ≠ ⑨+미납,
 *   10원 절사가 가산前 값으로 어긋남(현장 재보고: '합계 안 맞음').
 *
 * 수정: 가산-의존 토큰을 applyNightHolidaySurcharge **이후**(per-form enriched)에 재계산(DPP canon 순서 미러).
 *   본 spec 은 PMW applyPostSurchargePaidTokens 가 소비하는 **실제 SSOT 헬퍼 합성**을 정순서/버그순서로
 *   돌려 불변식을 검증한다(헬퍼 계약이 곧 PMW 출력토큰의 정합성).
 *
 * ★AC 매핑:
 *   - Σ(consult+exam+proc copay)=copayment, Σ(ins)=insurance_covered (급여 remainder=급여합계)
 *   - ⑧ patient_amount = ⑨ already_paid + ⑪ paidTotal + 미납 (checkBillReceiptPaidBoxInvariant.ok)
 *   - patient_amount 10원 절사 = 가산 反영 최종값 기준(가산後)
 *   - 진찰료 remainder = 가산 포함(진찰료 가산 유지) / 검사료(균검사) = 가산 미포함(base限定 결과 승계)
 *   - 평일(가산 kind=null) 무회귀: 정순서 == 버그순서 == 가산0 (양방향 회귀가드)
 *
 * 2026-07-18 = 토요일(dow===6, 법정공휴일 밖). 2026-07-13 = 월요일(평일). at()=로컬 Date(월 0-index).
 */
const at = (y: number, m: number, d: number, hh: number, mm = 0) => new Date(y, m - 1, d, hh, mm);
const n = (s: string | undefined): number => Number((s ?? '0').replace(/[^0-9.-]/g, '')) || 0;

// ── 시나리오 fixture: 토요일 진찰료 + 균검사(KOH) 혼재 ──────────────────────────────
//   진찰료(급여): covered 15,000 / 본인 4,500(30%) / 공단 10,500   ← 가산 대상(진찰료-only)
//   균검사(급여): covered  8,000 / 본인 2,400      / 공단  5,600   ← 가산 제외(검사료, 결함① base限定)
const CONSULT = { coveredTotal: 15000, copay: 4500 };
const EXAM = { coveredTotal: 8000, copay: 2400 };
const AGG = {
  grandTotal: CONSULT.coveredTotal + EXAM.coveredTotal,                 // 23,000
  copayment: CONSULT.copay + EXAM.copay,                                // 6,900
  insuranceCovered: (CONSULT.coveredTotal - CONSULT.copay) + (EXAM.coveredTotal - EXAM.copay), // 16,100
  nonCovered: 0,
};
// applyBillReceiptNewCoveredTokens 입력(computeBillReceiptNewCoveredBreakdown grain):
//   category '검사료' → exam 버킷 / '진찰료' → 진찰료 remainder 자연 흡수.
const billItems = [
  { category: '진찰료', amount: CONSULT.coveredTotal, is_insurance_covered: true, copayment_amount: CONSULT.copay },
  { category: '검사료', amount: EXAM.coveredTotal, is_insurance_covered: true, copayment_amount: EXAM.copay },
];
// 진찰료-only 가산 base(결함① 산출 결과를 결함② 입력으로 주입 — 균검사 제외).
const consultSurchargeBase = { covered: CONSULT.coveredTotal, copay: CONSULT.copay };

/**
 * PMW 신양식 출력토큰 렌더 시뮬레이션 — 실제 SSOT 헬퍼 합성.
 * @param saturday true=토요일(가산) / false=평일(무가산)
 * @param correctOrder true=가산 fold 後 재계산(수정본) / false=가산 fold 前 계산(버그 재현)
 */
function renderTokens(saturday: boolean, correctOrder: boolean) {
  const values: Record<string, string> = { visit_date: '2026-07-18' };
  // ① aggregate LiveTotals(가산-무관 base) — PMW applyBillReceiptNewSplitAndPaid 잔여부.
  applyBillReceiptNewLiveTotals(values, AGG);
  const refDate = saturday ? at(2026, 7, 18, 10) : at(2026, 7, 13, 10);
  const kind = detectSurchargeKind(refDate, false);

  const doFold = () =>
    applyNightHolidaySurcharge(values, 'bill_receipt_new', false, new Set(), refDate, buildSurchargeDetailRowHtml, consultSurchargeBase);
  const doRecompute = (): number => {
    const rawPatient = n(values.patient_amount);
    const { roundedTotal } = computeBillDetailRounding(rawPatient);
    if (rawPatient > 0) values.patient_amount = formatAmount(roundedTotal);
    applyBillReceiptNewCoveredTokens(values, billItems);
    applyBillReceiptPaidBoxTokens(values, [], roundedTotal, 0);
    return roundedTotal;
  };

  let patientFloored: number;
  if (correctOrder) {
    doFold();                       // 가산 fold → aggregate copayment/insurance_covered/patient_amount bump
    patientFloored = doRecompute(); // 가산後 재계산(DPP 순서 미러)
  } else {
    patientFloored = doRecompute(); // 가산前 계산(버그)
    doFold();                       // 이후 fold → remainder/납부박스 stale
  }
  return { values, kind, patientFloored };
}

test.describe('결함② — 토요일: 가산 fold 이후 재계산(정순서)만 출력토큰 정합', () => {
  test('★Σ(급여 remainder)=급여합계 · ⑧=⑨+⑪+미납 · 10원절사=가산後', () => {
    const { values, kind } = renderTokens(true, /* correctOrder */ true);
    expect(kind).not.toBeNull(); // 토요일 → 가산 적용

    const copayment = n(values.copayment);
    const insCovered = n(values.insurance_covered);
    // 가산 fold 확인: 진찰료 30% = round(15000*0.3)=4500, 본인 1350 / 공단 3150.
    const sc = computeSurcharge(CONSULT.coveredTotal, CONSULT.copay, kind);
    expect(sc.amount).toBe(4500);
    expect(copayment).toBe(AGG.copayment + sc.copay);            // 6900+1350 = 8250
    expect(insCovered).toBe(AGG.insuranceCovered + sc.covered);  // 16100+3150 = 19250

    // Σ(consult+exam+proc)=aggregate (급여 remainder = 급여합계, 진찰료 흡수 정합).
    const sumCopay = n(values.consult_copay) + n(values.exam_copay) + n(values.proc_copay);
    const sumIns = n(values.consult_ins) + n(values.exam_ins) + n(values.proc_ins);
    expect(sumCopay).toBe(copayment);
    expect(sumIns).toBe(insCovered);

    // 진찰료 remainder = 진찰료 본인/공단 + 가산 본인/공단(진찰료 가산 유지).
    expect(n(values.consult_copay)).toBe(CONSULT.copay + sc.copay);              // 4500+1350 = 5850
    expect(n(values.consult_ins)).toBe((CONSULT.coveredTotal - CONSULT.copay) + sc.covered); // 10500+3150 = 13650
    // 균검사(검사료) = 가산 미포함(결함① base限定 승계).
    expect(n(values.exam_copay)).toBe(EXAM.copay);                              // 2400 (가산 없음)
    expect(n(values.exam_ins)).toBe(EXAM.coveredTotal - EXAM.copay);            // 5600 (가산 없음)

    // ⑧ 환자부담총액(가산後 10원절사) = 급여 본인 + 비급여.
    expect(n(values.patient_amount)).toBe(copayment + AGG.nonCovered);          // 8250

    // 납부박스 불변식 ⑧=⑨+⑪+미납.
    const inv = checkBillReceiptPaidBoxInvariant(
      n(values.patient_amount),
      n(values.already_paid),
      n(values.paid_total),
      n(values.due_amount),
      n(values.unpaid_amount),
    );
    expect(inv.ok).toBe(true);
    expect(values._paidbox_invariant).toBe('ok');
    // ⑧ = ⑩(due, 미수납이므로 = 미납) 정합.
    expect(n(values.due_amount)).toBe(n(values.patient_amount));
  });

  test('버그순서(가산 前 계산) = 출력토큰 발산(회귀 witness)', () => {
    const { values } = renderTokens(true, /* correctOrder */ false);
    const copayment = n(values.copayment); // fold 반영 8250
    const sumCopay = n(values.consult_copay) + n(values.exam_copay) + n(values.proc_copay);
    // 버그: remainder 는 가산前(6900) 기준 → 합계(8250)와 어긋남.
    expect(sumCopay).not.toBe(copayment);
    expect(sumCopay).toBe(AGG.copayment); // 6900 (stale)
    // 버그: 납부박스 ⑩(due)은 가산前 ⑧(6900)로 산정 → 최종 patient(8250)와 발산.
    expect(n(values.due_amount)).not.toBe(n(values.patient_amount));
  });
});

test.describe('결함② — 평일 무회귀(양방향 회귀가드)', () => {
  test('평일: 가산 0 · 정순서==버그순서(순서 무관 동일) · Σ 정합', () => {
    const correct = renderTokens(false, true);
    const buggy = renderTokens(false, false);
    expect(correct.kind).toBeNull(); // 평일 → 가산 없음

    // 가산 없음: aggregate 불변, surcharge_amount 공란.
    expect(n(correct.values.copayment)).toBe(AGG.copayment);       // 6900 (무회귀)
    expect(n(correct.values.insurance_covered)).toBe(AGG.insuranceCovered); // 16100
    expect(correct.values.surcharge_amount ?? '').toBe('');

    // 순서 무관 동일(평일엔 fold=0이라 정순서/버그순서 결과 일치 = 무회귀).
    expect(correct.values.consult_copay).toBe(buggy.values.consult_copay);
    expect(correct.values.patient_amount).toBe(buggy.values.patient_amount);
    expect(correct.values.due_amount).toBe(buggy.values.due_amount);

    // Σ 정합 유지.
    const sumCopay = n(correct.values.consult_copay) + n(correct.values.exam_copay) + n(correct.values.proc_copay);
    expect(sumCopay).toBe(AGG.copayment);
    expect(n(correct.values.patient_amount)).toBe(AGG.copayment + AGG.nonCovered);
  });
});

test.describe('결함② — 진찰료 단독(진찰료 가산 누락 회귀가드)', () => {
  test('토요일 진찰료 단독(균검사 없음): 진찰료 30% 가산 정상 유지', () => {
    const values: Record<string, string> = { visit_date: '2026-07-18' };
    const aggSolo = {
      grandTotal: CONSULT.coveredTotal,
      copayment: CONSULT.copay,
      insuranceCovered: CONSULT.coveredTotal - CONSULT.copay,
      nonCovered: 0,
    };
    applyBillReceiptNewLiveTotals(values, aggSolo);
    const refDate = at(2026, 7, 18, 10);
    const kind = detectSurchargeKind(refDate, false);
    applyNightHolidaySurcharge(values, 'bill_receipt_new', false, new Set(), refDate, buildSurchargeDetailRowHtml, consultSurchargeBase);
    const rawPatient = n(values.patient_amount);
    const { roundedTotal } = computeBillDetailRounding(rawPatient);
    if (rawPatient > 0) values.patient_amount = formatAmount(roundedTotal);
    applyBillReceiptNewCoveredTokens(values, [
      { category: '진찰료', amount: CONSULT.coveredTotal, is_insurance_covered: true, copayment_amount: CONSULT.copay },
    ]);

    const sc = computeSurcharge(CONSULT.coveredTotal, CONSULT.copay, kind);
    expect(sc.amount).toBe(4500);
    // 진찰료 가산이 배제되지 않음(base=0 함정 회피) — consult remainder 에 가산 포함.
    expect(n(values.consult_copay)).toBe(CONSULT.copay + sc.copay);   // 5850
    expect(n(values.consult_ins)).toBe(aggSolo.insuranceCovered + sc.covered); // 13650
    // 검사 없음 → exam 토큰 공란.
    expect(values.exam_copay ?? '').toBe('');
  });
});
