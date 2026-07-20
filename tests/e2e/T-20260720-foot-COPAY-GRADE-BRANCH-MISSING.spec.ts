/**
 * E2E/unit spec — T-20260720-foot-COPAY-GRADE-BRANCH-MISSING
 *
 * 건보 등급별 본인부담 산출을 의원급(1차) 외래 법령정합으로 교정 (RPC calc_copayment v1.5 → v1.6):
 *   · low_income_1 (차상위 희귀·중증난치·중증) : 14% 정률 → 0원 면제 (copay=0 전용분기 신설)
 *   · low_income_2 (차상위 만성·18세미만)      : 14% 정률 → 정액 LEAST(1,000, base)
 *   · medical_aid_2 (의료급여 2종)             : 15% 정률 → 정액 LEAST(1,000, base)
 *   · medical_aid_1 / general / infant / elderly 4구간 / foreigner : 유지 (회귀 0)
 *
 * 근거: DA 재확정 da_ratify_copayment_grade_rates_20260720 (VERDICT=GO).
 *   국민건강보험법 시행령 별표2 제3호 라목(차상위) / 의료급여법 시행령 별표1(의급 1·2종 의원외래 정액 1,000).
 *   현행 14%/15% = 입원·병원급 요율을 의원급 외래에 오적용한 것(날조 아님).
 * ⚠ SCOPE CAVEAT: 정액/면제값 = 의원급 1차 외래 전용. 타 CRM(병원급·입원) 재사용 금지.
 *
 * SSOT: 등급→copay = copayFromBase 단일 헬퍼. RPC calc_copayment=단일권위, copayCalc.ts=미러(parity),
 *   footBilling 3계산기(computeFootBilling/fillBillItemCopayment/buildFootBillDetailItems)=동일 소비.
 * 회귀0: FLOOR(내림, CEIL 복귀 금지) / 공단부담 제외(수납잔액=자부담+비급여) / 노인 4구간 FLOOR / 병렬경로 신설 0.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  calcCopayment,
  copayFromBase,
  copayBasisText,
  getBaseCopayRate,
  type CopayCalcResult,
} from '../../src/lib/copayCalc';
import {
  computeFootBilling,
  type BillingService,
  type FootBillingItem,
} from '../../src/lib/footBilling';
import type { InsuranceGrade } from '../../src/lib/insurance';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const RPC_MIG = path.join(ROOT, 'supabase/migrations/20260720193000_calc_copayment_grade_flat_exempt.sql');
const RPC_ROLLBACK = path.join(ROOT, 'supabase/migrations/20260720193000_calc_copayment_grade_flat_exempt.rollback.sql');

// unit_value=1 → base = hira_score → 등급·경계·절사 정확 검증
function calc(grade: InsuranceGrade, base: number, override: number | null = null): CopayCalcResult {
  return calcCopayment(
    { is_insurance_covered: true, hira_score: base, copayment_rate_override: override, price: 0 },
    { hira_unit_value: 1 },
    grade,
  );
}

// 급여 항목(is_insurance_covered=true → getTaxClass '급여') 단건 → coveredTotal = price
function coveredItem(price: number): FootBillingItem {
  const svc: BillingService = {
    id: 'svc-1',
    name: '급여 시술',
    is_insurance_covered: true,
    hira_code: 'AA100',
    category_label: '풋케어',
    price,
  };
  return { service: svc, qty: 1, unitPrice: price };
}

test.describe('T-20260720 COPAY-GRADE-BRANCH-MISSING — 등급별 정상동선', () => {
  // base 13,710 (=흔한 진찰료 초진 규모)
  test('general 30% — 유지 (FLOOR, 회귀0)', () => {
    const r = calc('general', 13710);
    expect(r.copayment_amount).toBe(4100); // FLOOR(13710*0.3/100)*100
    expect(r.insurance_covered_amount).toBe(13710 - 4100);
    expect(r.applied_rate).toBe(0.3);
  });

  test('low_income_1 — 0원 면제 (전용분기 신설)', () => {
    const r = calc('low_income_1', 13710);
    expect(r.copayment_amount).toBe(0);
    expect(r.insurance_covered_amount).toBe(13710); // 공단부담 = base 전액
    expect(r.data_incomplete).toBe(false);
  });

  test('low_income_2 — 정액 1,000원 (종전 14% 정정)', () => {
    const r = calc('low_income_2', 13710);
    expect(r.copayment_amount).toBe(1000);
    expect(r.insurance_covered_amount).toBe(13710 - 1000);
  });

  test('medical_aid_1 — 정액 1,000원 (유지)', () => {
    const r = calc('medical_aid_1', 13710);
    expect(r.copayment_amount).toBe(1000);
    expect(r.insurance_covered_amount).toBe(13710 - 1000);
  });

  test('medical_aid_2 — 정액 1,000원 (종전 15% 정정)', () => {
    const r = calc('medical_aid_2', 13710);
    expect(r.copayment_amount).toBe(1000);
    expect(r.insurance_covered_amount).toBe(13710 - 1000);
  });

  test('infant 21% — 유지 (FLOOR, 회귀0)', () => {
    const r = calc('infant', 13710);
    expect(r.copayment_amount).toBe(2800); // FLOOR(13710*0.21/100)*100
  });
});

test.describe('T-20260720 — 경계 케이스', () => {
  // ── low_income_1 = 0원: 금액 무관 항상 면제 ──
  test('low_income_1 면제 — 저수가에서도 0원', () => {
    expect(calc('low_income_1', 500).copayment_amount).toBe(0);
    expect(calc('low_income_1', 50000).copayment_amount).toBe(0);
  });

  // ── 정액 상한: 수가 < 1,000이면 정액 ≤ 수가 (LEAST) ──
  test('정액 상한 — base < 1,000 → LEAST(1000, base) = base', () => {
    expect(calc('low_income_2', 800).copayment_amount).toBe(800);
    expect(calc('medical_aid_2', 447).copayment_amount).toBe(447);
    expect(calc('medical_aid_1', 999).copayment_amount).toBe(999);
    // base ≥ 1,000 → 정액 1,000 상한
    expect(calc('low_income_2', 1000).copayment_amount).toBe(1000);
    expect(calc('medical_aid_2', 1001).copayment_amount).toBe(1000);
  });

  // ── 노인 4구간 경계 = 이하(≤) inclusive + 정률구간 FLOOR (회귀0) ──
  test('elderly 4구간 경계 ≤ (inclusive) + FLOOR', () => {
    expect(calc('elderly_flat', 15000).copayment_amount).toBe(1500);            // ≤15,000 정액 1,500
    expect(calc('elderly_flat', 15001).copayment_amount).toBe(1500);            // 10% 구간 FLOOR(15.001*100)
    expect(calc('elderly_flat', 20000).copayment_amount).toBe(2000);            // ≤20,000 10% = FLOOR(20)*100
    expect(calc('elderly_flat', 20001).copayment_amount).toBe(4000);            // 20% 구간 FLOOR(40.002)*100
    expect(calc('elderly_flat', 25000).copayment_amount).toBe(5000);            // ≤25,000 20% = FLOOR(50)*100
    expect(calc('elderly_flat', 25001).copayment_amount).toBe(7500);            // >25,000 30% FLOOR(75.003)*100
  });

  test('elderly + override — 정률경로 흡수 (4구간 미적용)', () => {
    // override 있으면 노인 4구간 미적용 → ELSE 정률경로(FLOOR)
    const r = calc('elderly_flat', 8940, 0.10);
    expect(r.copayment_amount).toBe(800); // FLOOR(8940*0.10/100)*100
  });

  test('비급여/외국인 — 등급 무관 전액 (면제/정액 분기 이전 차단)', () => {
    const nonCovered = calcCopayment(
      { is_insurance_covered: false, hira_score: null, copayment_rate_override: null, price: 20000 },
      { hira_unit_value: 1 },
      'low_income_1', // 면제 등급이라도 비급여는 전액
    );
    expect(nonCovered.copayment_amount).toBe(20000);
    const foreigner = calc('foreigner', 13710);
    expect(foreigner.copayment_amount).toBe(0); // price=0 (전액경로, is_insurance_covered=true라도 foreigner 전액)
    expect(foreigner.applied_rate).toBe(1.0);
  });
});

test.describe('T-20260720 — copayFromBase 단일 SSOT 헬퍼', () => {
  test('면제/정액/정률 분기 직접 검증', () => {
    expect(copayFromBase('low_income_1', 13710, 0, false)).toBe(0);
    expect(copayFromBase('low_income_2', 13710, 0, false)).toBe(1000);
    expect(copayFromBase('medical_aid_1', 13710, 0, false)).toBe(1000);
    expect(copayFromBase('medical_aid_2', 447, 0, false)).toBe(447);
    expect(copayFromBase('general', 13710, 0.30, false)).toBe(4100);
    expect(copayFromBase('infant', 13710, 0.21, false)).toBe(2800);
    // base 0 → 0
    expect(copayFromBase('general', 0, 0.30, false)).toBe(0);
  });

  test('getBaseCopayRate — 정액/면제 등급 rate=0.00 (정보성)', () => {
    expect(getBaseCopayRate('low_income_1')).toBe(0);
    expect(getBaseCopayRate('low_income_2')).toBe(0);
    expect(getBaseCopayRate('medical_aid_1')).toBe(0);
    expect(getBaseCopayRate('medical_aid_2')).toBe(0);
    // 회귀0: 정률 등급 유지
    expect(getBaseCopayRate('general')).toBe(0.3);
    expect(getBaseCopayRate('infant')).toBe(0.21);
    expect(getBaseCopayRate('elderly_flat')).toBe(0.3);
  });
});

test.describe('T-20260720 — footBilling SSOT 배선 통일 (병렬 재계산 경로 신설 금지)', () => {
  test('computeFootBilling 정액/면제 분기 적용 + 공단부담 제외 정합', () => {
    // 급여 진료비 30,000 항목 1건
    const items = [coveredItem(30000)];

    // low_income_1 면제 → 본인 0, 공단 = 전액
    const li1 = computeFootBilling(items, 'low_income_1');
    expect(li1.copaymentTotal).toBe(0);
    expect(li1.liveBillingValues.copayment).toBe(0);
    expect(li1.liveBillingValues.insuranceCovered).toBe(30000); // 공단부담 = 급여 전액

    // medical_aid_2 정액 → 본인 1,000, 공단 = 29,000 (수납잔액=자부담, 공단 제외)
    const ma2 = computeFootBilling(items, 'medical_aid_2');
    expect(ma2.copaymentTotal).toBe(1000);
    expect(ma2.liveBillingValues.insuranceCovered).toBe(29000);

    // low_income_2 정액 → 본인 1,000
    expect(computeFootBilling(items, 'low_income_2').copaymentTotal).toBe(1000);

    // general 30% 유지 (FLOOR, 회귀0)
    const gen = computeFootBilling(items, 'general');
    expect(gen.copaymentTotal).toBe(9000); // FLOOR(30000*0.3/100)*100

    // elderly >25,000 → 30% FLOOR (4구간)
    const eld = computeFootBilling(items, 'elderly_flat');
    expect(eld.copaymentTotal).toBe(9000); // FLOOR(30000*0.3/100)*100
  });
});

test.describe('T-20260720 — FE↔RPC parity (마이그레이션 소스 단언)', () => {
  const mig = fs.readFileSync(RPC_MIG, 'utf-8');
  const rollback = fs.readFileSync(RPC_ROLLBACK, 'utf-8');

  test('v1.6 RPC: low_income_1 면제(copay=0) 전용분기', () => {
    expect(mig).toMatch(/v_grade\s*=\s*'low_income_1'/);
    expect(mig).toMatch(/v_copay\s*:=\s*0\s*;/);
  });

  test('v1.6 RPC: 정액 IN 확장 (medical_aid_1, low_income_2, medical_aid_2) LEAST(1000)', () => {
    expect(mig).toMatch(/v_grade\s+IN\s*\(\s*'medical_aid_1'\s*,\s*'low_income_2'\s*,\s*'medical_aid_2'\s*\)/);
    expect(mig).toMatch(/LEAST\(1000,\s*v_base\)/);
  });

  test('v1.6 RPC: v_rate CASE — 정액/면제 등급 0.00', () => {
    expect(mig).toMatch(/WHEN\s+'low_income_1'\s+THEN\s+0\.00/);
    expect(mig).toMatch(/WHEN\s+'low_income_2'\s+THEN\s+0\.00/);
    expect(mig).toMatch(/WHEN\s+'medical_aid_2'\s+THEN\s+0\.00/);
  });

  test('v1.6 RPC: 회귀0 — general/infant/elderly/FLOOR 유지', () => {
    expect(mig).toMatch(/WHEN\s+'general'\s+THEN\s+0\.30/);
    expect(mig).toMatch(/WHEN\s+'infant'\s+THEN\s+0\.21/);
    expect(mig).toMatch(/FLOOR\(\(v_base\s*\*\s*v_rate\)\s*\/\s*100\.0\)\s*\*\s*100/); // 일반경로 FLOOR (CEIL 복귀 금지)
    expect(mig).not.toMatch(/CEIL\(\(v_base/); // CEIL 잔존 0
    expect(mig).toMatch(/ADDITIVE:\s*CREATE OR REPLACE/); // 멱등·비파괴
  });

  test('rollback: v1.5 정률(14%/15%) 복원', () => {
    expect(rollback).toMatch(/WHEN\s+'low_income_1'\s+THEN\s+0\.14/);
    expect(rollback).toMatch(/WHEN\s+'low_income_2'\s+THEN\s+0\.14/);
    expect(rollback).toMatch(/WHEN\s+'medical_aid_2'\s+THEN\s+0\.15/);
  });
});

test.describe('T-20260720 — §3-6 라벨 오표기 정정 (copayBasisText)', () => {
  test('정액/면제/노인/외국인 = 기준명, general/infant/등급미상 = %(null)', () => {
    // 면제·정액 등급: v1.6 에서 getBaseCopayRate=0 → "0%" 오표기 방지 (기준명 반환)
    expect(copayBasisText('low_income_1')).toBe('면제');
    expect(copayBasisText('low_income_2')).toBe('정액');
    expect(copayBasisText('medical_aid_1')).toBe('정액');
    expect(copayBasisText('medical_aid_2')).toBe('정액');
    // 노인: 4구간 정률제 → "30%" 단일표기 오표기 방지
    expect(copayBasisText('elderly_flat')).toBe('정률제');
    expect(copayBasisText('foreigner')).toBe('전액');
    // 정률·등급미상: null → 호출부가 "N%" 표기 (general 30%, infant 21% 회귀0)
    expect(copayBasisText('general')).toBeNull();
    expect(copayBasisText('infant')).toBeNull();
    expect(copayBasisText('unverified')).toBeNull();
  });
});
