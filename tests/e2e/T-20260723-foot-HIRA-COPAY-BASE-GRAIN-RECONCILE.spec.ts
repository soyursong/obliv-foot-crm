/**
 * T-20260723-foot-HIRA-COPAY-BASE-GRAIN-RECONCILE
 *
 * 급여항목 copay base 이원화 해소 (C안 — pay-mini computeFootBilling 이 서버 calc_copayment 와
 *   동일 base 미러). 권위 base = ROUND(hira_score × clinics.hira_unit_value) — services.price 아님
 *   (DA da_decision_foot_hira_copay_base_grain_reconcile_20260723 Q1, §2-2-1).
 *
 * 배경(부모 T-20260723-foot-HIRA-SCORE-M0111-LOAD FOLLOWUP): M0111(단순처치) hira_score=75.51,
 *   환산지수 95.60 → 명세 base = ROUND(7218.756)=7219, 공단 5119. pay-mini 는 price=7220 base →
 *   공단 5120 (1원 divergence). price ≠ ROUND(score×환산지수)인 全 급여항목에 반복되는 구조.
 *
 * 본 스펙은 순수 계산함수(computeFootBilling)를 직접 구동한다(db_change=false → 서버/시드 불요).
 *   PaymentMiniWindow 는 clinics.hira_unit_value 를 로드해 opts.hiraUnitValue 로 주입 → 동일 산출값을
 *   렌더하므로, 함수 레벨 단언 = 결제 미니창 표시금액 검증과 등가(1:1 재현 함수).
 *
 * 실행: npx playwright test T-20260723-foot-HIRA-COPAY-BASE-GRAIN-RECONCILE.spec.ts
 */
import { test, expect } from '@playwright/test';
import {
  computeFootBilling,
  type FootBillingItem,
  type BillingService,
} from '../../src/lib/footBilling';
import type { InsuranceGrade } from '../../src/lib/insurance';

// M0111(단순처치) 재현 — hira_score 보유 급여 + price ≠ ROUND(score×환산지수).
const HIRA_SCORE = 75.51;
const HIRA_UNIT_VALUE = 95.6; // 2026 환산지수(clinics.hira_unit_value governed)
const PRICE = 7220;           // services.price (비-정본 base — 급여에 쓰면 divergence)
const ROUND_BASE = Math.round(HIRA_SCORE * HIRA_UNIT_VALUE); // ROUND(7218.756) = 7219

function m0111Service(): BillingService {
  return {
    id: 'svc-m0111',
    name: '[TEST] 단순처치 M0111',
    hira_code: 'M0111',
    hira_score: HIRA_SCORE,
    is_insurance_covered: true,
    vat_type: 'none',
    price: PRICE,
  };
}
function m0111Item(): FootBillingItem {
  return { service: m0111Service(), qty: 1, unitPrice: PRICE };
}

test.describe('HIRA copay base grain reconcile (C안, DA Q1: base=ROUND(score×환산지수))', () => {
  // 시나리오 사전 보증: price ≠ ROUND base (1원 divergence 유효 케이스).
  test('사전보증: price(7220) ≠ ROUND(hira_score×환산지수)(7219)', () => {
    expect(ROUND_BASE).toBe(7219);
    expect(PRICE).not.toBe(ROUND_BASE);
  });

  // AC-1/AC-4: hiraUnitValue 주입 → base=ROUND(7219), 공단=5119 (명세 calc_copayment 정합).
  //   general: copay = FLOOR(7219×0.30/100)×100 = 2100, 공단 = 7219 − 2100 = 5119.
  test('AC-1 general: base=ROUND(7219) → 공단 5119 (기존 5120 제거)', () => {
    const res = computeFootBilling([m0111Item()], 'general', { hiraUnitValue: HIRA_UNIT_VALUE });
    expect(res.coveredTotal).toBe(ROUND_BASE);            // 7219 (price 7220 아님)
    expect(res.copaymentTotal).toBe(2100);                // 본인부담 불변
    expect(res.liveBillingValues.insuranceCovered).toBe(5119); // 공단 5119 (명세 일치)
    expect(res.liveBillingValues.insuranceCovered).not.toBe(5120);
  });

  // 등급 미상(grade=null) 수납 grain(general_default) 도 동일 base 미러 → 공단 5119.
  test('AC-1 grade=null general_default: base=ROUND(7219) → 공단 5119', () => {
    const res = computeFootBilling([m0111Item()], null, {
      unknownGradeCopay: 'general_default',
      hiraUnitValue: HIRA_UNIT_VALUE,
    });
    expect(res.coveredTotal).toBe(ROUND_BASE);
    expect(res.copaymentTotal).toBe(2100);
    expect(res.liveBillingValues.insuranceCovered).toBe(5119);
  });

  // Backward-compat: hiraUnitValue 미주입 → 기존 price base(7220), 공단 5120 (전 호출부 회귀 0).
  test('backward-compat: hiraUnitValue 미주입 → price base 7220, 공단 5120 (기존 동작)', () => {
    const res = computeFootBilling([m0111Item()], 'general');
    expect(res.coveredTotal).toBe(PRICE);                 // 7220 (미주입 시 기존 price base)
    expect(res.liveBillingValues.insuranceCovered).toBe(5120);
  });

  // 시나리오 2 (엣지, AC-2): 비급여 항목 — ROUND 미적용, price 그대로 (회귀 0).
  test('AC-2 비급여: hiraUnitValue 주입해도 price base 유지(ROUND 미적용)', () => {
    const nonCov: BillingService = {
      id: 'svc-noncov', name: '[TEST] 비급여 시술', hira_score: 100, // 비급여엔 무의미
      is_insurance_covered: false, vat_type: 'exclusive', price: 55000,
    };
    const res = computeFootBilling(
      [{ service: nonCov, qty: 1, unitPrice: 55000 }],
      'general',
      { hiraUnitValue: HIRA_UNIT_VALUE },
    );
    expect(res.nonCoveredTotal).toBe(55000);              // price 그대로
    expect(res.coveredTotal).toBe(0);
    expect(res.grandTotal).toBe(55000);
  });

  // 시나리오 3 (엣지, AC-3): hira_score NULL 급여 — ROUND 불가 → price base 유지, 기존 폴백 동작.
  test('AC-3 hira_score NULL 급여: price base 유지(ROUND 미적용)', () => {
    const svcNoScore: BillingService = {
      id: 'svc-noscore', name: '[TEST] 급여 hira_score 없음', hira_code: 'Z9999',
      hira_score: null, is_insurance_covered: true, vat_type: 'none', price: 12340,
    };
    const item: FootBillingItem = { service: svcNoScore, qty: 1, unitPrice: 12340 };
    // grade=null covered_full 폴백(본인 전액/공단 0) — 기존 §2-2-1a 동작 그대로.
    const res = computeFootBilling([item], null, { hiraUnitValue: HIRA_UNIT_VALUE });
    expect(res.coveredTotal).toBe(12340);                 // price base (ROUND 미적용)
    expect(res.copaymentTotal).toBe(12340);               // covered_full 폴백 보존
  });

  // hira_unit_value NULL(미세팅) 급여+hira_score: price base 폴백 (§2-2-0 하드코딩 금지, BLOCK 대신 폴백).
  test('EDGE hira_unit_value 미주입(null)+hira_score: price base 폴백', () => {
    const res = computeFootBilling([m0111Item()], 'general', { hiraUnitValue: null });
    expect(res.coveredTotal).toBe(PRICE);                 // 7220 (환산지수 없음 → price 유지)
  });

  // 서버 calc_copayment 정합 재현: base·copay·공단 3자 = 명세 산식과 동일(급여×hira_score 존재).
  test('AC-4 서버 calc_copayment 산식 재현: ROUND base·FLOOR copay·공단 leg 정합', () => {
    const grades: InsuranceGrade[] = ['general', 'infant'];
    for (const grade of grades) {
      const rate = grade === 'general' ? 0.3 : 0.21;
      const base = Math.round(HIRA_SCORE * HIRA_UNIT_VALUE);
      const expectedCopay = Math.min(Math.floor((base * rate) / 100) * 100, base);
      const expectedGongdan = base - expectedCopay;
      const res = computeFootBilling([m0111Item()], grade, { hiraUnitValue: HIRA_UNIT_VALUE });
      expect(res.coveredTotal, `${grade} base`).toBe(base);
      expect(res.copaymentTotal, `${grade} copay`).toBe(expectedCopay);
      expect(res.liveBillingValues.insuranceCovered, `${grade} 공단`).toBe(expectedGongdan);
    }
  });
});
