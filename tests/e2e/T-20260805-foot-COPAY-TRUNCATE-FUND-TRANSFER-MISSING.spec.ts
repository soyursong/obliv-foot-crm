import { test, expect } from '@playwright/test';
import { detectSurchargeKind, computeSurcharge } from '../../src/lib/nightHolidaySurcharge';
import {
  floorOutpatientCopayment,
  absorbBillReceiptNewCopayFloorRemainder,
  applyBillReceiptNewLiveTotals,
} from '../../src/lib/footBilling';

/**
 * E2E — T-20260805-foot-COPAY-TRUNCATE-FUND-TRANSFER-MISSING (P0 hotfix, reporter 이은상 팀장)
 *
 * ▷ 증상(80원 실종): 야간·공휴일 급여 진료에서 본인부담을 100원 미만 절사(floor100)하면 제거된 끝수가
 *   공단부담에 가산되지 않고 소실 → 본인 3,300 + 공단 8,060 = 11,360 ≠ 급여총액 11,440 (보존식 위반).
 * ▷ 정답: 건강보험법 시행령 제22조1항(본인부담 100원 미만 끝수 = 공단부담). 공단부담 = 급여총액 − 본인부담(floor後)
 *   로 파생 → 끝수 자동 흡수. 본인 3,300 + 공단 8,140 = 11,440 == 총액. 불변식 base = copayment + insurance_covered.
 * ▷ db_change=false (FE 계산 레이어). service_charges.insurance_covered_amount 서버 적재값(calc_copayment RPC
 *   v_covered:=v_base−v_copay)은 이미 정답산식 — 본 티켓은 FE 표시/수납·인쇄 grain 독립계산 버그만 정합(RC MSG-105201-st49).
 *
 * ⚠ 순수함수 assert (page/auth 불요). 아래 settle() 은 PaymentMiniWindow 수납 grain 정산 파생식 1:1 미러,
 *   absorb 직접 테스트는 신양식(bill_receipt_new) ①②(인쇄·명세) SSOT 헬퍼를 검증한다.
 */
const at = (y: number, m: number, d: number, hh: number, mm = 0) => new Date(y, m - 1, d, hh, mm);
const amt = (s: string | undefined) => Number((s ?? '0').replace(/[^0-9.-]/g, '')) || 0;

/** PaymentMiniWindow 수납 grain 정산 파생식 1:1 미러 (T-20260805 FUND-TRANSFER 반영). */
function settle(coveredTotal: number, payCopaymentTotal: number, nonCovered: number, refDate: Date) {
  const insuranceCoveredTotal = Math.max(0, coveredTotal - payCopaymentTotal);
  const grandTotal = coveredTotal + nonCovered;
  const kind = detectSurchargeKind(refDate, false);
  const sc = computeSurcharge(coveredTotal, payCopaymentTotal, kind);
  const gupyeoRawCopay = payCopaymentTotal + sc.copay;              // 급여 본인부담(절사 전, 가산 포함)
  const gupyeoCovered = insuranceCoveredTotal + sc.covered;         // 급여 공단부담(가산 포함)
  const copayFloored = floorOutpatientCopayment(gupyeoRawCopay);    // 외래 100원 FLOOR
  const covered = gupyeoCovered > 0
    ? Math.max(0, (gupyeoRawCopay + gupyeoCovered) - copayFloored)  // 공단 = 급여총액 − 본인(floor後) → 끝수 흡수(보존식)
    : gupyeoCovered;                                                // 공단 0(등급부재/비급여) 유지
  return {
    kind, surcharge: sc,
    copayment: copayFloored,
    covered,
    grand: grandTotal + sc.amount,
    payable: copayFloored + nonCovered,
    gupyeoTotal: gupyeoRawCopay + gupyeoCovered,
  };
}

test.describe('AC-1/2 — 재현 케이스: 본인부담 floor100 끝수(80원) 공단 흡수, 보존식 성립', () => {
  test('★수납 grain: 본인 3,300 + 공단 8,140 = 11,440 (구버그 8,060/11,360 아님)', () => {
    // 급여 진찰료 8,800(본인 2,600=30% floor100) + 공휴일(토) 30% 가산 → rawCopay 3,380(끝수 발생).
    const r = settle(8800, 2600, 0, at(2026, 7, 25, 10));
    expect(r.kind).toBe('holiday');
    expect(r.copayment).toBe(3300);                 // 본인부담(floor100)
    expect(r.covered).toBe(8140);                   // ★ 공단부담 = 끝수 80원 흡수 (구버그 8,060 아님)
    expect(r.covered).not.toBe(8060);               // 회귀 가드: 80원 실종 재발 금지
    expect(r.grand).toBe(11440);                    // 진료비 총액 불변
    // ★ 보존식(불변식): 본인부담(절사후) + 공단부담 == 급여 총액
    expect(r.copayment + r.covered).toBe(r.gupyeoTotal);
    expect(r.copayment + r.covered).toBe(11440);    // 3,300 + 8,140 = 11,440
  });

  test('AC-8 수납잔액 무회귀: 수납잔액 = 본인부담(floor후) + 비급여 (공단 미합산)', () => {
    const r = settle(8800, 2600, 5000, at(2026, 7, 25, 10)); // 비급여 5,000 혼합
    expect(r.copayment).toBe(3300);
    expect(r.payable).toBe(3300 + 5000);            // 수납잔액 = 본인 + 비급여 (공단 제외) — COPAY-BALANCE-SPLIT 무회귀
    // 급여 보존식은 여전히 성립(비급여와 직교).
    expect(r.copayment + r.covered).toBe(r.gupyeoTotal);
  });
});

test.describe('AC-3 무회귀 — floor 끝수 없거나 공단 부재면 기존 거동', () => {
  test('무가산(평일): 끝수 0 → 공단부담 종전값 6,200 보존', () => {
    const r = settle(8800, 2600, 0, at(2026, 7, 14, 10)); // 화요일 평일
    expect(r.kind).toBeNull();
    expect(r.copayment).toBe(2600);
    expect(r.covered).toBe(6200);                   // 급여총액 8,800 − 본인 2,600 = 6,200 (불변)
    expect(r.copayment + r.covered).toBe(8800);
  });

  test('가산 있어도 합이 100원 배수면 no-op (정률 100원 배수 경로)', () => {
    const r = settle(10000, 3000, 0, at(2026, 7, 25, 10)); // rawCopay 3,900(100배수)
    expect(r.copayment).toBe(3900);
    expect(r.covered).toBe(9100);                   // 13,000 − 3,900 = 9,100 (끝수 0 → 종전값)
    expect(r.copayment + r.covered).toBe(13000);
  });

  test('AC-7 등급부재(grade=null, 공단 0)·비급여only: 공단 0 유지, 끝수 이전 없음', () => {
    const nullGrade = settle(11440, 11440, 0, at(2026, 7, 25, 10)); // 본인=급여전액, 공단 0
    expect(nullGrade.covered).toBe(0);              // 끝수를 공단(0)으로 이전하지 않음(스코프 밖 무회귀)
    const nonCovOnly = settle(0, 0, 8800, at(2026, 7, 25, 14));     // 비급여only
    expect(nonCovOnly.covered).toBe(0);
    expect(nonCovOnly.payable).toBe(8800);
  });
});

test.describe('AC-6 인쇄·명세 SSOT — absorbBillReceiptNewCopayFloorRemainder (신양식 ①②)', () => {
  test('★재현 케이스 직접: ①3,380→3,300 · ②8,060→8,140 (끝수 80원 공단 흡수)', () => {
    const v: Record<string, string> = { copayment: '3,380', insurance_covered: '8,060' };
    absorbBillReceiptNewCopayFloorRemainder(v);
    expect(v.copayment).toBe('3,300');
    expect(v.insurance_covered).toBe('8,140');
    // 보존식: ①+② == 급여총액(11,440) 불변.
    expect(amt(v.copayment) + amt(v.insurance_covered)).toBe(11440);
  });

  test('no-op 가드: 끝수 0(100배수) / 공단 0(grade=null) / 본인 0(비급여) → 불변', () => {
    const mult100: Record<string, string> = { copayment: '3,300', insurance_covered: '8,140' };
    absorbBillReceiptNewCopayFloorRemainder(mult100);
    expect(mult100.copayment).toBe('3,300');
    expect(mult100.insurance_covered).toBe('8,140'); // 끝수 0 → no-op

    const nullGrade: Record<string, string> = { copayment: '11,440', insurance_covered: '0' };
    absorbBillReceiptNewCopayFloorRemainder(nullGrade);
    expect(nullGrade.copayment).toBe('11,440');       // 공단 0 → no-op(AC-7)
    expect(nullGrade.insurance_covered).toBe('0');

    const nonCov: Record<string, string> = { copayment: '0', insurance_covered: '0' };
    absorbBillReceiptNewCopayFloorRemainder(nonCov);
    expect(nonCov.copayment).toBe('0');
  });

  test('전체 파이프라인(라이브총액 → absorb): 수납창과 동일 ①② 보존식 값 (AC-6 3경로 정합)', () => {
    // applyBillReceiptNewLiveTotals 로 aggregate 세팅(가산 fold 후 상태를 직접 주입: 본인 3,380 / 공단 8,060).
    const v: Record<string, string> = {};
    applyBillReceiptNewLiveTotals(v, { grandTotal: 11440, insuranceCovered: 8060, copayment: 3380, nonCovered: 0 });
    expect(v.copayment).toBe('3,380');   // absorb 이전 = 독립계산 raw
    absorbBillReceiptNewCopayFloorRemainder(v);
    // absorb 이후 = 수납창 settle() 과 동일값(3,300 / 8,140) → 인쇄 == 수납 정합.
    const s = settle(8800, 2600, 0, at(2026, 7, 25, 10));
    expect(amt(v.copayment)).toBe(s.copayment);
    expect(amt(v.insurance_covered)).toBe(s.covered);
    expect(amt(v.copayment) + amt(v.insurance_covered)).toBe(11440);
  });
});
