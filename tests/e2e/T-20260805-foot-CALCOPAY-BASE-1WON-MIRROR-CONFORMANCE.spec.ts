/**
 * E2E — T-20260805-foot-CALCOPAY-BASE-1WON-MIRROR-CONFORMANCE
 * 급여 base 단가 1원 canon 미러 정합 — footBilling 급여 base 를 calc_copayment ROUND(1원) base 와 동일 규칙으로 통일.
 *
 * 배경(DA CONSULT-REPLY MSG-20260805-172801-riiz §Q2 · canon update MSG-20260805-224633-9acx §12/§13):
 *   급여 base authority = calc_copayment RPC 의 ROUND(hira_score × hira_unit_value) = 1원 반올림 canon.
 *   종전 진찰료(AA154/AA254)는 EXAMFEE-FLAT-GOSIA carve-out 으로 services.price(10원 flat 18,840)를 base 로
 *   써서 calc_copayment(18,845) 와 1원(5원) 어긋나고, 그 차가 전액 공단 leg 로 흡수 → 공단부담 수 원 편차
 *   (5,119 vs 5,120 / 13,240 vs 13,245 류). fu5j supersede: 진찰료도 시술 급여 base 와 동일하게 1원 canon
 *   미러링(carve-out REVERSED). services.price 를 급여 base authority 로 쓰지 않음.
 *
 * 순수함수 검증(브라우저 불요) — computeFootBilling(급여 base 소스) / computeBillDetailRounding(인접 stage 격리).
 * fixture = 2026-08-05 prod(rxlomoozakkjesdqjtvd) services 실측 shape (service_role READ-ONLY probe).
 *
 * AC-1 (fix): 진찰료(AA154) billing base = 1원 canon ROUND(197.12×95.60)=18,845 (services.price 18,840 아님).
 * AC-2 (동일규칙): 진찰료 base 산출 규칙 = 시술 급여 base 규칙(ROUND(score×unit)) 과 동일 — 진찰료 exempt 분기 없음.
 * AC-3 (파생 정합): 공단부담 = base − copay 가 1원 canon 기준 산출(13,245 / 5,119) — 종전 price 흡수 편차 소멸.
 * AC-4 (round_10 금지): base 는 1원 grain(끝자리 5 유지) — 10원 반올림(round_10) 미도입.
 * AC-5 (인접 stage 격리): computeBillDetailRounding(floor10 문서 총액 절사) 는 base 소스와 직교 — 불변.
 * AC-6 (backward-compat): hiraUnitValue 미주입 시 기존 price base 유지(전 호출부 회귀 0).
 * AC-7 (scope 경계): 주어진 hira_score(197.12) 를 그대로 사용 — seed-score 값 정정(197.07) 아님(A10 별도 트랙).
 *
 * @see T-20260805-foot-CALCOPAY-BASE-1WON-MIRROR-CONFORMANCE
 * @see da_decision_foot_hira_copay_base_grain_reconcile_20260723
 */

import { test, expect } from '@playwright/test';
import {
  computeFootBilling,
  computeBillDetailRounding,
  type BillingService,
  type FootBillingItem,
} from '../../src/lib/footBilling';

// ─── prod 실측 shape (2026-08-05, service_role READ-ONLY probe) ───
const HIRA_UNIT = 95.6; // clinics.hira_unit_value (의원 2026 환산지수)

// 초진진찰료(AA154) — 종전 carve-out 대상. price(18,840) ≠ ROUND(score×unit)(18,845).
const svcInitExam: BillingService = {
  id: 'de611ed5-154a-475d-9eb3-19d6d3bad881',
  name: '초진진찰료-의원',
  service_code: 'AA154',
  hira_code: null,
  hira_category: null,
  hira_score: 197.12,
  category_label: '기본',
  price: 18840, // services.price (flat 고시액 10원 grain — 급여 base authority 로 쓰지 않음)
  is_insurance_covered: true,
  vat_type: 'none',
};

// M0111(단순처치) 시술 급여 — price(7220) ≠ ROUND(75.51×95.6)=7219. 공단 5119 conformance 재현.
const svcM0111: BillingService = {
  id: 'svc-m0111',
  name: '[TEST] 단순처치 M0111',
  hira_code: 'M0111',
  hira_score: 75.51,
  is_insurance_covered: true,
  vat_type: 'none',
  price: 7220,
};

// AA222 시술 base RVU 축 — 진찰료 carve-out 과 무관, 항상 1원 canon(4,693). 격리 가드.
const svcProcReVisit: BillingService = {
  id: '1a82c70a-07fe-4321-be44-8a206e3d1aa0',
  name: '재진-물리치료,주사 등 시술받은 경우',
  service_code: 'AA222',
  hira_code: null,
  hira_category: null,
  hira_score: 49.09,
  category_label: '기본',
  price: 4690,
  is_insurance_covered: true,
  vat_type: 'none',
};

const item = (svc: BillingService): FootBillingItem => ({
  service: svc,
  qty: 1,
  unitPrice: svc.price ?? 0, // = customAmounts ?? service.price (PMW 라인 단가)
});
const withMirror = { hiraUnitValue: HIRA_UNIT } as const;

test.describe('T-20260805 급여 base 1원 canon 미러 정합 (진찰료 포함)', () => {
  // 사전보증: 진찰료 price(18,840) ≠ 1원 canon(18,845) — divergence 유효 케이스.
  test('사전보증: 초진진찰료 price(18,840) ≠ ROUND(score×unit)(18,845)', () => {
    expect(Math.round(197.12 * HIRA_UNIT)).toBe(18845);
    expect(svcInitExam.price).toBe(18840);
    expect(svcInitExam.price).not.toBe(18845);
  });

  // AC-1/AC-2: 진찰료 billing base 가 1원 canon(18,845) 으로 통일 — services.price(18,840) 미사용.
  test('AC-1 진찰료 billing base = 1원 canon 18,845 (services.price 18,840 아님)', () => {
    const r = computeFootBilling([item(svcInitExam)], 'general', withMirror);
    expect(r.coveredTotal).toBe(18845);
    expect(r.coveredTotal).not.toBe(18840);
  });

  // AC-2: 진찰료·시술이 **동일 규칙**(ROUND(score×unit))으로 산출 — 진찰료 전용 exempt 분기 없음.
  test('AC-2 진찰료 + 시술(M0111·AA222) = 전부 1원 canon 동일 규칙', () => {
    const r = computeFootBilling(
      [item(svcInitExam), item(svcM0111), item(svcProcReVisit)],
      'general',
      withMirror,
    );
    // 각 항목이 ROUND(score×unit): 18,845 + 7,219 + 4,693 = 30,757
    expect(r.coveredTotal).toBe(18845 + 7219 + 4693);
  });

  // AC-3 (파생 정합): 진찰료 공단부담 = 1원 canon base − copay. 종전 price(18,840) 흡수 편차(13,240) 소멸.
  //   general: copay = FLOOR(18845×0.30/100)×100 = 5,600, 공단 = 18,845 − 5,600 = 13,245.
  test('AC-3 진찰료 공단부담 = 13,245 (1원 canon, 종전 price 흡수 13,240 아님)', () => {
    const r = computeFootBilling([item(svcInitExam)], 'general', withMirror);
    expect(r.copaymentTotal).toBe(5600);
    expect(r.liveBillingValues.insuranceCovered).toBe(13245);
    expect(r.liveBillingValues.insuranceCovered).not.toBe(13240);
  });

  // AC-3 (파생 정합, 시술 grain): M0111 공단 = 5,119 (1원 canon), 종전 price base 5,120 아님.
  test('AC-3 시술(M0111) 공단부담 = 5,119 (1원 canon, 5,120 아님)', () => {
    const r = computeFootBilling([item(svcM0111)], 'general', withMirror);
    expect(r.coveredTotal).toBe(7219);
    expect(r.copaymentTotal).toBe(2100);
    expect(r.liveBillingValues.insuranceCovered).toBe(5119);
    expect(r.liveBillingValues.insuranceCovered).not.toBe(5120);
  });

  // AC-4 (round_10 금지): base 는 1원 grain — 끝자리 5 유지(10원 반올림이면 18,840/18,850 가 됨).
  test('AC-4 base 는 1원 grain(끝자리 5) — round_10(10원 반올림) 미도입', () => {
    const r = computeFootBilling([item(svcInitExam)], 'general', withMirror);
    expect(r.coveredTotal % 10).not.toBe(0); // 18,845 → 1원 canon (10원 배수 아님)
    // round_10 이면 18,840(floor) 또는 18,850(round) 이 됐어야 함 — 둘 다 아님.
    expect([18840, 18850]).not.toContain(r.coveredTotal);
  });

  // AC-5 (인접 stage 격리): computeBillDetailRounding(floor10) 은 base 소스와 직교 — 여전히 10원 절사.
  test('AC-5 computeBillDetailRounding(floor10) 인접 stage 불변 (base 소스와 직교)', () => {
    // 진찰료 본인부담(5,600) + 비급여 우수리(예 3,333) = 8,933 → floor10 = 8,930, 조정 −3.
    const { adjustment, roundedTotal } = computeBillDetailRounding(8933);
    expect(roundedTotal).toBe(8930);
    expect(adjustment).toBe(-3);
    // 이미 10원 배수면 조정 0 (이중절사·중복상쇄 없음).
    expect(computeBillDetailRounding(13245).roundedTotal).toBe(13240);
  });

  // AC-6 (backward-compat): hiraUnitValue 미주입 → 기존 price base(18,840) 유지 — 전 호출부 회귀 0.
  test('AC-6 backward-compat: hiraUnitValue 미주입 → price base 18,840 (기존 동작)', () => {
    const r = computeFootBilling([item(svcInitExam)], 'general'); // opts 없음
    expect(r.coveredTotal).toBe(18840);
  });

  // AC-7 (scope 경계): 주어진 hira_score(197.12) 를 그대로 사용 — seed-score 값 정정(197.07) 아님.
  test('AC-7 scope: hira_score(197.12) 그대로 사용 — seed-score 정정 out-of-scope', () => {
    const r = computeFootBilling([item(svcInitExam)], 'general', withMirror);
    expect(r.coveredTotal).toBe(Math.round(197.12 * HIRA_UNIT)); // 197.12 기준(197.07 정정 아님)
  });
});
