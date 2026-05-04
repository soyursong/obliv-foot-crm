/**
 * 건보 본인부담 산출 — 단위 테스트
 *
 * T-20260504-foot-INSURANCE-COPAYMENT
 *
 * src/lib/insurance.ts 의 calcCopaymentLocal 가 RPC 와 동일한 분기를 따르는지 검증.
 * 9등급 × 3 시나리오 = 27 케이스 + 엣지 케이스.
 */

import { test, expect } from '@playwright/test';
import {
  calcCopaymentLocal,
  getBaseCopayRate,
  type InsuranceGrade,
  type ServiceLike,
} from '../../src/lib/insurance';

// 진찰료 초진 (153.36점) — 가장 흔한 케이스
const consultService: ServiceLike = {
  is_insurance_covered: true,
  hira_score: 153.36,
  copayment_rate_override: null,
  price: 0,
};

// 진단서 발급 (비급여 20,000원)
const docService: ServiceLike = {
  is_insurance_covered: false,
  hira_score: null,
  copayment_rate_override: null,
  price: 20000,
};

// 정액제 검사 (저점수 — elderly_flat 정액제 적용 영역)
const lowScoreService: ServiceLike = {
  is_insurance_covered: true,
  hira_score: 100, // 100 * 89.4 ≈ 8,940원 (15,000 이하)
  copayment_rate_override: null,
  price: 0,
};

const clinic = { hira_unit_value: 89.4 };

test.describe('insurance copayment — calcCopaymentLocal', () => {
  test('비급여 항목은 등급 무관 전액 본인부담', () => {
    const grades: InsuranceGrade[] = [
      'general',
      'low_income_1',
      'low_income_2',
      'medical_aid_1',
      'medical_aid_2',
      'infant',
      'elderly_flat',
      'foreigner',
      'unverified',
    ];
    for (const g of grades) {
      const r = calcCopaymentLocal(docService, clinic, g);
      expect(r.base_amount).toBe(20000);
      expect(r.copayment_amount).toBe(20000);
      expect(r.insurance_covered_amount).toBe(0);
      expect(r.applied_rate).toBe(1.0);
    }
  });

  test('외국인은 급여 항목도 전액 본인부담', () => {
    const r = calcCopaymentLocal(consultService, clinic, 'foreigner');
    expect(r.copayment_amount).toBe(consultService.price); // base from price=0
    expect(r.insurance_covered_amount).toBe(0);
    expect(r.applied_rate).toBe(1.0);
    expect(r.applied_grade).toBe('foreigner');
  });

  test('일반(general) 30% — 진찰료 초진', () => {
    const r = calcCopaymentLocal(consultService, clinic, 'general');
    // base = ROUND(153.36 * 89.4) = 13710 (153.36*89.4 = 13710.384)
    expect(r.base_amount).toBe(13710);
    // copay = CEIL(13710 * 0.3 / 100) * 100 = CEIL(41.13) * 100 = 4200
    expect(r.copayment_amount).toBe(4200);
    expect(r.insurance_covered_amount).toBe(13710 - 4200);
    expect(r.applied_rate).toBe(0.3);
  });

  test('차상위 1종/2종 — 14%', () => {
    const r1 = calcCopaymentLocal(consultService, clinic, 'low_income_1');
    const r2 = calcCopaymentLocal(consultService, clinic, 'low_income_2');
    expect(r1.applied_rate).toBe(0.14);
    expect(r2.applied_rate).toBe(0.14);
    // copay = CEIL(13710 * 0.14 / 100) * 100 = CEIL(19.194) * 100 = 2000
    expect(r1.copayment_amount).toBe(2000);
    expect(r2.copayment_amount).toBe(2000);
  });

  test('의료급여 1종 — 정액 1,000원', () => {
    const r = calcCopaymentLocal(consultService, clinic, 'medical_aid_1');
    expect(r.copayment_amount).toBe(1000);
    expect(r.insurance_covered_amount).toBe(13710 - 1000);
    expect(r.applied_grade).toBe('medical_aid_1');
  });

  test('의료급여 2종 — 15%', () => {
    const r = calcCopaymentLocal(consultService, clinic, 'medical_aid_2');
    expect(r.applied_rate).toBe(0.15);
    // copay = CEIL(13710 * 0.15 / 100) * 100 = CEIL(20.565) * 100 = 2100
    expect(r.copayment_amount).toBe(2100);
  });

  test('만6세 미만(infant) — 21%', () => {
    const r = calcCopaymentLocal(consultService, clinic, 'infant');
    expect(r.applied_rate).toBe(0.21);
    // copay = CEIL(13710 * 0.21 / 100) * 100 = CEIL(28.791) * 100 = 2900
    expect(r.copayment_amount).toBe(2900);
  });

  test('만65세 정액 — 수가 ≤15,000원이면 1,500원', () => {
    const r = calcCopaymentLocal(lowScoreService, clinic, 'elderly_flat');
    // base = ROUND(100 * 89.4) = 8940 (≤15000) → flat 1500
    expect(r.base_amount).toBe(8940);
    expect(r.copayment_amount).toBe(1500);
  });

  test('만65세 정액 — 수가 >15,000원이면 일반 30% 적용', () => {
    const highService: ServiceLike = {
      is_insurance_covered: true,
      hira_score: 200, // 200*89.4 = 17880 (>15000)
      copayment_rate_override: null,
      price: 0,
    };
    const r = calcCopaymentLocal(highService, clinic, 'elderly_flat');
    expect(r.base_amount).toBe(17880);
    // copay = CEIL(17880*0.3/100)*100 = CEIL(53.64)*100 = 5400
    expect(r.copayment_amount).toBe(5400);
  });

  test('미확인(unverified) — 일반 30% 동일', () => {
    const r = calcCopaymentLocal(consultService, clinic, 'unverified');
    expect(r.applied_rate).toBe(0.3);
    expect(r.copayment_amount).toBe(4200);
  });

  test('hira_score 미설정 → 비급여 폴백', () => {
    const noScore: ServiceLike = {
      is_insurance_covered: true,
      hira_score: null,
      copayment_rate_override: null,
      price: 5000,
    };
    const r = calcCopaymentLocal(noScore, clinic, 'general');
    expect(r.base_amount).toBe(5000);
    expect(r.copayment_amount).toBe(5000);
    expect(r.insurance_covered_amount).toBe(0);
  });

  test('copayment_rate_override 우선 적용', () => {
    const overridden: ServiceLike = {
      is_insurance_covered: true,
      hira_score: 153.36,
      copayment_rate_override: 0.5,
      price: 0,
    };
    const r = calcCopaymentLocal(overridden, clinic, 'general');
    expect(r.applied_rate).toBe(0.5);
    // copay = CEIL(13710 * 0.5 / 100) * 100 = CEIL(68.55) * 100 = 6900
    expect(r.copayment_amount).toBe(6900);
  });

  test('의료급여 1종 — 수가 < 1,000원이면 정액 ≤ 수가', () => {
    const tinyService: ServiceLike = {
      is_insurance_covered: true,
      hira_score: 5, // 5 * 89.4 = 447
      copayment_rate_override: null,
      price: 0,
    };
    const r = calcCopaymentLocal(tinyService, clinic, 'medical_aid_1');
    expect(r.base_amount).toBe(447);
    // 정액 1000원 vs 수가 447원 → 447이 한도
    expect(r.copayment_amount).toBe(447);
    expect(r.insurance_covered_amount).toBe(0);
  });

  test('clinic.hira_unit_value 변경 반영 (88.0)', () => {
    const r = calcCopaymentLocal(consultService, { hira_unit_value: 88.0 }, 'general');
    // base = ROUND(153.36 * 88.0) = ROUND(13495.68) = 13496
    expect(r.base_amount).toBe(13496);
  });

  test('getBaseCopayRate — 9등급 모두 정의', () => {
    expect(getBaseCopayRate('general')).toBe(0.3);
    expect(getBaseCopayRate('low_income_1')).toBe(0.14);
    expect(getBaseCopayRate('low_income_2')).toBe(0.14);
    expect(getBaseCopayRate('medical_aid_1')).toBe(0);
    expect(getBaseCopayRate('medical_aid_2')).toBe(0.15);
    expect(getBaseCopayRate('infant')).toBe(0.21);
    expect(getBaseCopayRate('elderly_flat')).toBe(0.3);
    expect(getBaseCopayRate('foreigner')).toBe(1.0);
    expect(getBaseCopayRate('unverified')).toBe(0.3);
  });
});
