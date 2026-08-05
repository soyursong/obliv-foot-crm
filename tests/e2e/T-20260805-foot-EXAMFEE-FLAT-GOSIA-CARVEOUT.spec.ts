/**
 * E2E — T-20260805-foot-EXAMFEE-FLAT-GOSIA-CARVEOUT  [billing carve-out SUPERSEDED → REVERSED]
 * 초진/재진 진찰료 billing base = 1원 canon mirror (18,845) — 종전 flat 고시액(18,840) carve-out REVERSED
 *
 * ⚠ SUPERSEDE: T-20260805-foot-CALCOPAY-BASE-1WON-MIRROR-CONFORMANCE (DA CONSULT-REPLY
 *   MSG-20260805-224633-9acx §12/§13, fu5j supersede) 가 이 티켓의 **billing carve-out** premise 를 정정했다.
 *   - 종전(이 스펙 원본): 진찰료 billing base = 공표 flat 고시액(services.price 18,840), score×unit(1원 canon) exempt.
 *   - 정정(DA §12): 진찰료 billing-canonical = calc_copayment ROUND(score×unit, 1원) = 초진 18,845 (AA222 parity).
 *     ∴ coveredBaseUnit 의 진찰료 exempt(carve-out) 제거 → 진찰료 billing base 도 시술 급여 base 와 동일하게
 *       1원 canon 미러링. "18,845" 는 defect 이 아니라 billing 정본.
 *   - 클라 표시 carve-out(문서에 18,840 렌더)은 별개 P3 display-unify 트랙(reporter surface 게이트)로 이관 —
 *     billing base 집계와 무관. isFlatPublishedExamFee identity 술어는 그 트랙 위해 유지(coveredBaseUnit 호출만 제거).
 *
 * 순수함수 검증(브라우저 불요) — computeFootBilling / isFlatPublishedExamFee / isConsultationFeeItem.
 * fixture = 2026-08-05 prod(rxlomoozakkjesdqjtvd) services 실측 shape (service_role READ-ONLY probe).
 *
 * AC-1 (REVERSED): 초진진찰료 billing base = 18,845 (1원 canon mirror 포함, 종전 flat 18,840 아님).
 * AC-2 (REVERSED): 진찰료 + 시술(AA222) 혼합 카트 = 둘 다 1원 canon(18,845 + 4,693).
 * AC-3 (no-op): 재진진찰료 = 13,370 (ROUND(139.85×95.60)=13,370, flat==canon 우연 일치 → 불변).
 * AC-4 (가드): AA222(재진-물리치료·주사 등 시술받은 경우, score 49.09) = 시술 base 1원 canon 유지(4,693).
 * AC-5 (가드): price 미설정(0) 진찰료 legacy row = score×unit 경로(14,661), ₩0 회귀 방지 — 불변.
 * AC-6 (가드): isConsultationFeeItem(가산 base 술어) 는 AA222 를 여전히 포함(불변) — 가산 회귀 0.
 *
 * @see T-20260805-foot-EXAMFEE-FLAT-GOSIA-CARVEOUT
 * @see T-20260805-foot-CALCOPAY-BASE-1WON-MIRROR-CONFORMANCE (supersede)
 * @see da_decision_foot_initfee_examfee_flat_gosia_axis_reconcile_20260805
 */

import { test, expect } from '@playwright/test';
import {
  computeFootBilling,
  isFlatPublishedExamFee,
  isConsultationFeeItem,
  type BillingService,
  type FootBillingItem,
} from '../../src/lib/footBilling';

// ─── prod 실측 shape (2026-08-05, service_role READ-ONLY probe) ───
const HIRA_UNIT = 95.6; // clinics.hira_unit_value (오블리브 풋센터 송도 = 의원 환산지수, §4-3 의원 confirm)

const svcInitExam: BillingService = {
  id: 'de611ed5-154a-475d-9eb3-19d6d3bad881',
  name: '초진진찰료-의원',
  service_code: 'AA154',
  hira_code: null,
  hira_category: null,
  hira_score: 197.12, // provenance only — amount 미feed
  category_label: '기본',
  price: 18840, // 공표 flat 고시액 (2026 의원 초진, byte-source)
  is_insurance_covered: true,
  vat_type: 'none',
};

const svcReExam: BillingService = {
  id: '117befad-e8f8-48c6-b496-89c37a68a441',
  name: '재진진찰료-의원',
  service_code: 'AA254',
  hira_code: null,
  hira_category: null,
  hira_score: 139.85,
  category_label: '기본',
  price: 13370, // 공표 flat 고시액 (2026 의원 재진 grounding)
  is_insurance_covered: true,
  vat_type: 'none',
};

// AA222 = 재진-물리치료 등 시술받은 경우 = 시술 base RVU 축(1원 canon), 진찰료 flat 아님 (DA §10-2 census)
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

// price 미설정(0) legacy 진찰료 — hira_category=consultation 이나 flat 고시액 부재
const svcLegacyExamNoPrice: BillingService = {
  id: 'b98f6831-12a3-459b-b199-f543dd15cba1',
  name: '진찰료 (초진)',
  service_code: null,
  hira_code: 'AA154',
  hira_category: 'consultation',
  hira_score: 153.36,
  category_label: null,
  price: 0,
  is_insurance_covered: true,
  vat_type: 'none',
};

const item = (svc: BillingService, unitPrice = svc.price ?? 0, qty = 1): FootBillingItem => ({
  service: svc,
  qty,
  unitPrice, // = customAmounts ?? service.price (PMW 라인 단가)
});

// 1원 mirror context = hiraUnitValue 주입(급여 base = ROUND(score×unit)) 활성
const withMirror = { hiraUnitValue: HIRA_UNIT } as const;

test.describe('T-20260805 진찰료 billing base [carve-out REVERSED → 1원 canon mirror]', () => {
  test('AC-1 [REVERSED] 초진진찰료 billing base = 18,845 (1원 canon mirror 포함)', () => {
    // T-20260805-CALCOPAY-BASE-1WON-MIRROR-CONFORMANCE (DA §12/§13 fu5j supersede): 진찰료 billing base 도
    //   시술 급여 base 와 동일하게 1원 canon = ROUND(197.12×95.60) = 18,845 (종전 flat carve-out 18,840 REVERSED).
    const r = computeFootBilling([item(svcInitExam)], 'general', withMirror);
    expect(r.coveredTotal).toBe(18845);
    expect(r.coveredTotal).not.toBe(18840);
    expect(Math.round(197.12 * HIRA_UNIT)).toBe(18845);
    // identity 술어는 불변(true) — display-unify 트랙 위해 유지(billing base 집계와 무관).
    expect(isFlatPublishedExamFee(svcInitExam, 'general')).toBe(true);
  });

  test('AC-2 [REVERSED] 진찰료 + 시술(AA222) 혼합 카트 = 둘 다 1원 canon (18,845 + 4,693)', () => {
    // 진찰료(초진)도 이제 1원 canon(18,845), 시술(AA222)도 1원 canon(4,693) — 동일 규칙 수렴.
    const r = computeFootBilling(
      [item(svcInitExam), item(svcProcReVisit)],
      'general',
      withMirror,
    );
    expect(r.coveredTotal).toBe(18845 + 4693); // 23,538
  });

  test('AC-3 재진진찰료 = 13,370 (ROUND(139.85×95.60)=13,370, flat==canon 우연 일치 → no-op)', () => {
    const r = computeFootBilling([item(svcReExam)], 'general', withMirror);
    expect(r.coveredTotal).toBe(13370);
    expect(r.coveredTotal).toBe(Math.round(139.85 * HIRA_UNIT)); // 1원 canon 과 flat 이 동일값
    expect(isFlatPublishedExamFee(svcReExam, 'general')).toBe(true);
  });

  test('AC-4 [가드] AA222 시술 base = 1원 canon(4,693) 유지 — carve-out 미적용', () => {
    // 시술 base 1원 4사5입 canon 무접촉: score×unit=4,693 (stored price 4,690 아님).
    const r = computeFootBilling([item(svcProcReVisit)], 'general', withMirror);
    expect(r.coveredTotal).toBe(4693);
    expect(r.coveredTotal).not.toBe(4690);
    // AA222 는 진찰료 flat 축이 아님(명칭 '진찰료'/'상담' 미포함 → 배제)
    expect(isFlatPublishedExamFee(svcProcReVisit, 'general')).toBe(false);
  });

  test('AC-5 [가드] price=0 legacy 진찰료 = carve-out 제외 (₩0 회귀 방지, score×unit 유지)', () => {
    // price 미설정 → flat 고시액 부재 → score×unit 경로 유지: 153.36×95.6 = 14,661.
    const r = computeFootBilling([item(svcLegacyExamNoPrice)], 'general', withMirror);
    expect(r.coveredTotal).toBe(Math.round(153.36 * HIRA_UNIT)); // 14,661
    expect(r.coveredTotal).not.toBe(0);
    // 술어 identity 는 true(consultation) 이나 price>0 가드로 carve-out 미적용 → 회귀 없음.
    expect(isFlatPublishedExamFee(svcLegacyExamNoPrice, 'general')).toBe(true);
  });

  test('AC-6 [가드] isConsultationFeeItem(가산 base 술어) 불변 — AA222 여전히 포함', () => {
    // 가산(야간/공휴) base 술어는 넓은 매칭(AA222 포함) 유지 — flat carve-out 술어와 별개.
    expect(isConsultationFeeItem(svcProcReVisit, 'general')).toBe(true);
    expect(isConsultationFeeItem(svcInitExam, 'general')).toBe(true);
    // flat 술어는 AA222 배제(더 좁음) — 두 술어가 의도적으로 다름을 확인
    expect(isFlatPublishedExamFee(svcProcReVisit, 'general')).toBe(false);
  });

  test('AC-7 [가드] 비급여 진찰료(공휴일 초진 등) 미영향 — 급여 아님 → carve-out 대상 밖', () => {
    const svcNonCovered: BillingService = {
      ...svcInitExam,
      id: '3eb86239-af92-468c-afd3-94daa28acad6',
      name: '공휴일 초진진찰료-의원',
      hira_score: null,
      price: 24490,
      is_insurance_covered: false,
    };
    expect(isFlatPublishedExamFee(svcNonCovered, 'general')).toBe(false);
    const r = computeFootBilling([item(svcNonCovered)], 'general', withMirror);
    expect(r.coveredTotal).toBe(0); // 급여 aggregate 0 (비급여 버킷)
  });
});
