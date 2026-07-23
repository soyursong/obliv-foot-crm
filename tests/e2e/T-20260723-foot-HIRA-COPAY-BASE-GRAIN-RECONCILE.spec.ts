/**
 * E2E/unit spec — T-20260723-foot-HIRA-COPAY-BASE-GRAIN-RECONCILE (C안)
 *
 * 풋 급여 공단부담 base 정합 (DA GO / da_decision_foot_hira_copay_base_grain_reconcile_20260723):
 *   권위 base = ROUND(hira_score × hira_unit_value) (services.price 아님). pay-mini(computeFootBilling)가
 *   급여(is_insurance_covered=TRUE)×hira_score 존재 항목 한해 서버 명세(calc_copayment §정상분기)와 동일 base
 *   를 미러한다. hira_unit_value 는 clinics governed 값(호출부 주입) — 하드코딩·연도상수 금지(§2-2-0).
 *
 * UI-observable = 결제 미니창(PaymentMiniWindow) 금액. 결제창은 computeFootBilling 산출값을 그대로 표기하므로
 *   순수함수 산출값 검증 = 결제창 금액 검증(기존 COPAY spec 동형).
 *
 * AC:
 *   1. M0111 general 공단부담 = 5119 (명세 calc_copayment 일치, 기존 price base 5120 제거).
 *   2. 비급여 결제창 금액 무변화 (회귀 0).
 *   3. hira_score 없는 급여항목 · hira_unit_value 미주입(폴백) → 기존 price base 동작 유지 (회귀 0).
 *   4. 서버 calc_copayment = pay-mini 결과 (급여×hira_score 존재 항목 일치, parity).
 */
import { test, expect } from '@playwright/test';
import {
  computeFootBilling,
  type BillingService,
  type FootBillingItem,
} from '../../src/lib/footBilling';
import { calcCopayment } from '../../src/lib/copayCalc';

/**
 * M0111 재현 시드: general 등급, 급여 진찰료성 항목. 서버 calc_copayment 정상분기와 동일하게
 *   base = ROUND(hira_score × hira_unit_value). 공단부담 = base − copay, copay = FLOOR(base×0.3/100)×100.
 *
 * price=수가 "우연일치"가 1원 어긋난 상황을 재현(DA 판정: 진찰료 3건 price=수가 우연일치였음):
 *   · suga base = ROUND(81.02 × 89.1) = ROUND(7218.882) = 7219  → copay=FLOOR(7219×0.3/100)×100=2100
 *       → 공단 = 7219 − 2100 = 5119  ← canonical (명세 calc_copayment 일치)
 *   · price base = 7220 (수가+1 우연일치)                         → copay 동일 2100 (FLOOR 100 흡수)
 *       → 공단 = 7220 − 2100 = 5120  ← 기존 pay-mini 버그값(제거 대상)
 */
const HIRA_UNIT = 89.1; // clinics.hira_unit_value (governed, 예시값 — 하드코딩 아님, 호출부 주입 미러)
const M0111_SCORE = 81.02;
const M0111_PRICE = 7220;

function coveredItem(opts: {
  hira_score: number | null;
  price: number;
  covered?: boolean;
  id?: string;
}): FootBillingItem {
  const svc: BillingService = {
    id: opts.id ?? 'svc-covered',
    name: '급여 진찰료',
    is_insurance_covered: opts.covered ?? true,
    hira_code: 'AA100',
    hira_score: opts.hira_score,
    category_label: '기본',
    vat_type: 'none',
    price: opts.price,
  };
  return { service: svc, qty: 1, unitPrice: opts.price };
}

function nonCoveredItem(price: number): FootBillingItem {
  const svc: BillingService = {
    id: 'svc-noncov',
    name: '비급여 시술',
    is_insurance_covered: false,
    category_label: '풋케어',
    vat_type: 'exclusive',
    price,
  };
  return { service: svc, qty: 1, unitPrice: price };
}

test.describe('T-20260723 HIRA-COPAY-BASE-GRAIN-RECONCILE — 급여 base = ROUND(hira_score × hira_unit_value)', () => {
  // ── AC1: M0111 general 공단부담 = 5119 (canonical suga base), 기존 price base 5120 제거 ──────
  test('AC1 — M0111 급여×hira_score general: 공단부담 = 5119 (기존 5120 제거)', () => {
    const items = [coveredItem({ hira_score: M0111_SCORE, price: M0111_PRICE })];
    const r = computeFootBilling(items, 'general', { hiraUnitValue: HIRA_UNIT });

    const expectedBase = Math.round(M0111_SCORE * HIRA_UNIT); // 7219 (price 7220 아님)
    const expectedCopay = Math.floor((expectedBase * 0.3) / 100) * 100; // 2100

    expect(expectedBase).toBe(7219);
    expect(r.coveredTotal).toBe(7219); // suga base — price(7220) 아님
    expect(r.copaymentTotal).toBe(2100);
    expect(r.liveBillingValues.insuranceCovered).toBe(5119); // ← canonical(명세 일치)
    // 기존 price base 였다면 공단 = 7220 − 2100 = 5120 → 제거 확인(AC1)
    expect(r.liveBillingValues.insuranceCovered).not.toBe(5120);
    expect(r.liveBillingValues.insuranceCovered).not.toBe(M0111_PRICE - expectedCopay);
  });

  test('AC1 — 급여 다건 합산 base 도 suga 기준(집계 grain)', () => {
    const items = [
      coveredItem({ id: 'a', hira_score: 40.0, price: 3565 }),  // ROUND(3564.0)=3564
      coveredItem({ id: 'b', hira_score: 41.02, price: 3656 }), // ROUND(3654.882)=3655
    ];
    const r = computeFootBilling(items, 'general', { hiraUnitValue: HIRA_UNIT });
    const base = Math.round(40.0 * HIRA_UNIT) + Math.round(41.02 * HIRA_UNIT); // 3564 + 3655 = 7219
    expect(r.coveredTotal).toBe(base);
    expect(r.coveredTotal).not.toBe(3565 + 3656); // price 합(7221) 아님
  });

  // ── AC4: 서버 calc_copayment parity (동일 base·동일 copay 규칙) ────────────────────────
  test('AC4 — computeFootBilling coveredTotal = calcCopayment base_amount (parity)', () => {
    for (const [score, price] of [[M0111_SCORE, M0111_PRICE], [40.0, 3565], [13.5, 1203]] as const) {
      const server = calcCopayment(
        { is_insurance_covered: true, hira_score: score, copayment_rate_override: null, price },
        { hira_unit_value: HIRA_UNIT },
        'general',
      );
      const mini = computeFootBilling([coveredItem({ hira_score: score, price })], 'general', {
        hiraUnitValue: HIRA_UNIT,
      });
      // 단건 → 집계 copay = 서버 단건 copay (FLOOR 규칙 동일, copayFromBase 단일 SSOT)
      expect(mini.coveredTotal).toBe(server.base_amount);
      expect(mini.copaymentTotal).toBe(server.copayment_amount);
      expect(mini.liveBillingValues.insuranceCovered).toBe(server.insurance_covered_amount);
    }
  });

  // ── AC2: 비급여 무변화 (회귀 0) ────────────────────────────────────────────────────────
  test('AC2 — 비급여 항목은 price base 유지 (hiraUnitValue 주입돼도 무영향)', () => {
    const items = [nonCoveredItem(50000)];
    const withUnit = computeFootBilling(items, 'general', { hiraUnitValue: HIRA_UNIT });
    const withoutUnit = computeFootBilling(items, 'general');
    expect(withUnit.nonCoveredTotal).toBe(50000);
    expect(withUnit.grandTotal).toBe(50000);
    expect(withUnit.coveredTotal).toBe(0);
    // 주입 유무와 무관하게 동일 (비급여는 base override 대상 아님)
    expect(withUnit.nonCoveredTotal).toBe(withoutUnit.nonCoveredTotal);
    expect(withUnit.grandTotal).toBe(withoutUnit.grandTotal);
  });

  test('AC2 — 급여+비급여 혼합: 급여만 suga base, 비급여 price 유지', () => {
    const items = [
      coveredItem({ id: 'cov', hira_score: M0111_SCORE, price: M0111_PRICE }),
      nonCoveredItem(30000),
    ];
    const r = computeFootBilling(items, 'general', { hiraUnitValue: HIRA_UNIT });
    expect(r.coveredTotal).toBe(Math.round(M0111_SCORE * HIRA_UNIT)); // 7219
    expect(r.nonCoveredTotal).toBe(30000);
    expect(r.grandTotal).toBe(Math.round(M0111_SCORE * HIRA_UNIT) + 30000);
  });

  // ── AC3: hira_score NULL / hira_unit_value 미주입 → 기존 price base (회귀 0) ─────────────
  test('AC3 — hira_score NULL 급여항목은 price base 유지 (override 미적용)', () => {
    const items = [coveredItem({ hira_score: null, price: 12000 })];
    const r = computeFootBilling(items, 'general', { hiraUnitValue: HIRA_UNIT });
    // hira_score 없으면 suga 산출 불가 → price(unitPrice) base 유지
    expect(r.coveredTotal).toBe(12000);
  });

  test('AC3 — hiraUnitValue 미주입(폴백)이면 급여도 price base 유지 (무파괴)', () => {
    const items = [coveredItem({ hira_score: M0111_SCORE, price: M0111_PRICE })];
    const noUnit = computeFootBilling(items, 'general'); // opts 없음
    const nullUnit = computeFootBilling(items, 'general', { hiraUnitValue: null });
    expect(noUnit.coveredTotal).toBe(M0111_PRICE); // price base
    expect(nullUnit.coveredTotal).toBe(M0111_PRICE);
  });

  test('AC3 — grade=null 급여 방문: base 는 suga 로 정합, 폴백 분기(본인=전액/공단=0)는 불변', () => {
    const items = [coveredItem({ hira_score: M0111_SCORE, price: M0111_PRICE })];
    // 서류(기본) grain: covered_full 폴백 = 본인 전액, 공단 0. 분기 자체는 티켓이 바꾸지 않음(§scope 4).
    const doc = computeFootBilling(items, null, { hiraUnitValue: HIRA_UNIT });
    expect(doc.coveredTotal).toBe(Math.round(M0111_SCORE * HIRA_UNIT)); // base=suga(7219)
    expect(doc.copaymentTotal).toBe(doc.coveredTotal); // 본인=전액(공단=0) 폴백 분기 유지
    expect(doc.liveBillingValues.insuranceCovered).toBe(0); // 공단=0
  });
});
