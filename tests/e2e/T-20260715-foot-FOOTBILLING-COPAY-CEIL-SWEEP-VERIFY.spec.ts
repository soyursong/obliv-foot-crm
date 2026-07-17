/**
 * T-20260715-foot-FOOTBILLING-COPAY-CEIL-SWEEP-VERIFY
 *
 * 급여 본인부담금(copayment) rounding CEIL→FLOOR 정정 검증 (footBilling.ts 중복구현 갭).
 *   - footBilling.ts:L275 round100 + L595 copaymentTotal 의 Math.ceil → Math.floor.
 *   - 규정: CIT-2026-001(건보법 시행령 별표2 100원미만 제외) + CIT-2026-002(심평원 외래본인부담 100원미만 절사)
 *     + revenue_insurance_split_spec §2-2 v1.12(절사=round-DOWN). 종전 절상(CEIL)=체계적 초과징수(최대 99원/건).
 *   - 선례(패턴 이식): T-20260715-women-FOOTBILLING-COPAY-CEIL-SWEEP-VERIFY (women footBilling.ts:273/494 이미 FLOOR).
 *
 * 본 스펙은 순수 계산함수(computeFootBilling) 를 직접 구동한다(db_change=false → 서버/시드 불요).
 *   PaymentMiniWindow / DocumentPrintPanel 은 동일 computeFootBilling 산출값을 렌더하므로,
 *   함수 레벨 FLOOR 단언 = 수납 표시금액 절사 렌더 검증과 등가(1:1 재현 함수, L245~ 주석).
 *
 * 실행: npx playwright test T-20260715-foot-FOOTBILLING-COPAY-CEIL-SWEEP-VERIFY.spec.ts
 */
import { test, expect } from '@playwright/test';
import {
  computeFootBilling,
  getBaseCopayRate,
  type FootBillingItem,
  type BillingService,
} from '../../src/lib/footBilling';
import type { InsuranceGrade } from '../../src/lib/insurance';

// 급여 대상 서비스(hira_code 보유 + 보험적용) — grade∈COVERED_GRADES 이면 getTaxClass='급여'.
function coveredService(id: string): BillingService {
  return { id, name: `[TEST] ${id}`, hira_code: 'X0000', is_insurance_covered: true, vat_type: 'none' };
}
function mkCovered(coveredTotal: number, id = 'svc-covered'): FootBillingItem {
  return { service: coveredService(id), qty: 1, unitPrice: coveredTotal };
}

// 기대 FLOOR 산식(정정 후) 과 종전 CEIL(정정 전) 을 모두 계산해 실제로 절사되는 케이스임을 보장.
const floor100 = (coveredTotal: number, rate: number) =>
  Math.min(Math.floor((coveredTotal * rate) / 100) * 100, coveredTotal);
const ceil100 = (coveredTotal: number, rate: number) =>
  Math.min(Math.ceil((coveredTotal * rate) / 100) * 100, coveredTotal);

// (grade, coveredTotal, 100원 미만 잔차가 발생하도록 선정) — FLOOR≠CEIL 이 되는 실효 케이스.
const CASES: Array<{ id: string; grade: InsuranceGrade; coveredTotal: number }> = [
  { id: 'C1 general 30% 절사',       grade: 'general',      coveredTotal: 41134 }, // 12340.2 → 12300 (CEIL 12400)
  { id: 'C3 low_income_1 14% 절사',  grade: 'low_income_1', coveredTotal: 33333 }, // 4666.62 → 4600 (CEIL 4700)
  { id: 'C4 infant 21% 절사',        grade: 'infant',       coveredTotal: 12345 }, // 2592.45 → 2500 (CEIL 2600)
  { id: 'C6 elderly_flat 30% 절사',  grade: 'elderly_flat', coveredTotal: 40001 }, // 12000.3 → 12000 (CEIL 12100) base>15000
  { id: 'C8 medical_aid_2 15% 절사', grade: 'medical_aid_2', coveredTotal: 12345 }, // 1851.75 → 1800 (CEIL 1900)
];

test.describe('footBilling copayment rounding CEIL→FLOOR (AC-2/AC-3)', () => {
  for (const c of CASES) {
    test(`${c.id}: 본인부담금 100원 미만 절사(내림)`, () => {
      const rate = getBaseCopayRate(c.grade);
      const expectedFloor = floor100(c.coveredTotal, rate);
      const expectedCeil = ceil100(c.coveredTotal, rate);
      // 이 케이스가 실제로 절사 유효(FLOOR≠CEIL)한지 사전 보증 — 무의미 케이스 방지.
      expect(expectedFloor, `${c.id}: FLOOR·CEIL 동일 = 잔차 없는 무의미 케이스`).toBeLessThan(expectedCeil);

      const res = computeFootBilling([mkCovered(c.coveredTotal)], c.grade);
      expect(res.coveredTotal).toBe(c.coveredTotal);
      // 정정 후: FLOOR 값과 일치, 종전 CEIL 값과 불일치.
      expect(res.copaymentTotal).toBe(expectedFloor);
      expect(res.copaymentTotal).not.toBe(expectedCeil);
    });
  }

  // C5: medical_aid_1(0%) → 본인부담 0 (절사 무영향).
  test('C5 medical_aid_1 0%: 본인부담금 0', () => {
    const res = computeFootBilling([mkCovered(50000)], 'medical_aid_1');
    expect(res.copaymentTotal).toBe(0);
  });

  // C2: 정확히 100원 배수로 떨어지는 급여 → FLOOR·CEIL 동일(회귀 0).
  test('C2 general 30% 정배수: 회귀 없음', () => {
    const res = computeFootBilling([mkCovered(10000)], 'general'); // 3000 정배수
    expect(res.copaymentTotal).toBe(3000);
  });

  // 시나리오2(엣지): 무보험/등급 미상(copayRate=null) → 기본 폴백('covered_full') 미개입 보존.
  test('EDGE grade=null covered_full: 본인 전액(공단=0) 폴백 보존', () => {
    const covered = 29380;
    const res = computeFootBilling([mkCovered(covered)], null);
    expect(res.copaymentTotal).toBe(covered); // 전액 본인, 절사 분기 미진입
  });

  // 수납 grain 폴백(general_default): 등급 미상 → 외래 기본 30% FLOOR(종전 CEIL 8900 → 정정 8800).
  test('EDGE grade=null general_default: 30% 절사 적용(FLOOR)', () => {
    const covered = 29380; // 8814 → FLOOR 8800 (CEIL 8900)
    const res = computeFootBilling([mkCovered(covered)], null, { unknownGradeCopay: 'general_default' });
    expect(res.copaymentTotal).toBe(floor100(covered, getBaseCopayRate('general')));
    expect(res.copaymentTotal).toBe(8800);
    expect(res.copaymentTotal).not.toBe(8900);
  });
});
