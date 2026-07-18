/**
 * E2E/unit spec — T-20260715-foot-COPAY-GENERAL-CEIL-TO-FLOOR-FIX
 * 일반 정률경로(비-노인: general 30% / low_income_1·2 14% / medical_aid_2 15% / infant 21% / ELSE)
 * 원단위 = 100원 미만 절사(FLOOR) 확정 회귀.
 *
 * ★ 정정: 종전 v1.4 일반 정률경로 CEIL(100원 절상) → FLOOR(100원 미만 절사, v1.5).
 *   (v1.4 는 elderly 4구간만 FLOOR, 일반경로 CEIL 잔존 = 일반경로 급여 체계적 초과징수 최대 99원/건.)
 * 규정 근거:
 *   · CIT-2026-001 국민건강보험법 시행령 별표2 §19① "100원 미만은 제외한다" (외래 본인부담 전반 FLOOR)
 *   · CIT-2026-002 심평원 외래 본인부담기준표 "100원미만 절사" (전 구분 동일)
 *   · revenue_insurance_split_spec §2-2 v1.12 (copayment = round-DOWN)
 * SSOT: 서버 RPC calc_copayment v1.5 = 단일권위, copayCalc.ts = 미러(FE↔RPC parity).
 * elderly 4구간(v1.4 FLOOR)·medical_aid_1 MIN(1000,base)·정수배 케이스는 무영향/회귀 0.
 *
 * 실행: npx playwright test T-20260715-foot-COPAY-GENERAL-CEIL-TO-FLOOR-FIX.spec.ts
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { calcCopayment, getBaseCopayRate, type CopayCalcResult } from '../../src/lib/copayCalc';
import type { InsuranceGrade } from '../../src/lib/insurance';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const COPAY_CALC = path.join(ROOT, 'src/lib/copayCalc.ts');
const RPC_MIG = path.join(ROOT, 'supabase/migrations/20260715150000_calc_copayment_general_floor_rounding.sql');

// unit_value=1 → base = hira_score → 일반 정률경로 절사 경계 정확 검증
function calcGeneral(base: number, grade: InsuranceGrade = 'general', override: number | null = null): CopayCalcResult {
  return calcCopayment(
    { is_insurance_covered: true, hira_score: base, copayment_rate_override: override, price: 0 },
    { hira_unit_value: 1 },
    grade,
  );
}
/** 규정 FLOOR 재현식 (코드와 독립 계산). */
const floor100 = (base: number, rate: number) => Math.min(Math.floor((base * rate) / 100) * 100, base);
/** 종전 버그 CEIL (대조용). */
const ceil100 = (base: number, rate: number) => Math.min(Math.ceil((base * rate) / 100) * 100, base);

test.describe('T-20260715 일반 정률경로 100원 미만 절사(FLOOR) — general 30%', () => {
  // ── ★ 절사 자체 회귀: 정수배 아닌 값(초과징수 정정 증명) ──────────────────
  test('general 30%: 수가 29,380 × 30% = 8,814 → 절사 8,800 (CEIL 8,900 아님)', () => {
    const r = calcGeneral(29380);
    expect(r.data_incomplete).toBe(false);
    expect(r.applied_rate).toBe(0.30);
    expect(r.copayment_amount).toBe(8800);
    expect(r.copayment_amount).not.toBe(8900);            // 종전 CEIL 폐기
    expect(ceil100(29380, 0.30) - r.copayment_amount).toBe(100); // 초과징수 정확히 100원 제거
    expect(r.insurance_covered_amount).toBe(29380 - 8800); // 공단 = base - 본인 (배타 불변식)
  });

  test('general 30%: 수가 12,345 × 30% = 3,703.5 → 절사 3,700 (CEIL 3,800 아님)', () => {
    expect(calcGeneral(12345).copayment_amount).toBe(3700);
    expect(calcGeneral(12345).copayment_amount).not.toBe(3800);
  });

  // ── 경계값: base×rate < 100 → 본인부담 0 (100원 미만 전부 절사) ───────────
  test('경계: 수가 100 × 30% = 30 → 절사 0 (CEIL 100 아님) · 공단 100', () => {
    const r = calcGeneral(100);
    expect(r.copayment_amount).toBe(0);
    expect(r.copayment_amount).not.toBe(100);
    expect(r.insurance_covered_amount).toBe(100);
  });

  // ── 정수배 회귀: 절사/절상 동일 (회귀 0) ─────────────────────────────────
  test('정수배 30,000 × 30% = 9,000 → 9,000 (정수배, 절사 무관 · 회귀 0)', () => {
    expect(calcGeneral(30000).copayment_amount).toBe(9000);
    expect(floor100(30000, 0.30)).toBe(ceil100(30000, 0.30)); // 동일 증명
  });
});

test.describe('T-20260715 일반 정률경로 FLOOR — 타 등급(전 정률 등급 동일 규칙)', () => {
  // rate 별 non-정수배 → 절사. 각 등급이 ELSE 정률경로를 타는지 확인.
  const CASES: Array<{ grade: InsuranceGrade; base: number; rate: number; floor: number; ceil: number }> = [
    { grade: 'low_income_1', base: 10050, rate: 0.14, floor: 1400, ceil: 1500 }, // 1407
    { grade: 'low_income_2', base: 10050, rate: 0.14, floor: 1400, ceil: 1500 }, // 1407
    { grade: 'medical_aid_2', base: 10050, rate: 0.15, floor: 1500, ceil: 1600 }, // 1507.5
    { grade: 'infant', base: 10050, rate: 0.21, floor: 2100, ceil: 2200 },        // 2110.5
    { grade: 'unverified', base: 12345, rate: 0.30, floor: 3700, ceil: 3800 },    // ELSE→0.30
  ];
  for (const c of CASES) {
    test(`${c.grade} ${c.rate * 100}%: 수가 ${c.base} → 절사 ${c.floor} (CEIL ${c.ceil} 아님)`, () => {
      const r = calcGeneral(c.base, c.grade);
      expect(getBaseCopayRate(c.grade)).toBe(c.rate);
      expect(r.copayment_amount).toBe(c.floor);
      expect(r.copayment_amount).toBe(floor100(c.base, c.rate)); // 규정식 일치
      expect(r.copayment_amount).not.toBe(c.ceil);               // 초과징수 폐기
    });
  }

  // ── 무영향 회귀: elderly 4구간·medical_aid_1 은 일반경로 아님 ──────────────
  test('회귀: medical_aid_1 = MIN(1000, base) (정률 아님, 무영향)', () => {
    expect(calcGeneral(5000, 'medical_aid_1').copayment_amount).toBe(1000);
    expect(calcGeneral(800, 'medical_aid_1').copayment_amount).toBe(800);
  });
  test('회귀: elderly_flat 정률구간은 4구간 FLOOR(별경로) 유지 — base 18,050 → 1,800', () => {
    expect(calcGeneral(18050, 'elderly_flat').copayment_amount).toBe(1800);
  });
  test('회귀: elderly override 시 일반경로(ELSE) 흡수 → FLOOR 적용: base 12,345 × 0.3 → 3,700', () => {
    expect(calcGeneral(12345, 'elderly_flat', 0.30).copayment_amount).toBe(3700);
  });
});

test.describe('T-20260715 parity — RPC v1.5 (단일권위) ↔ copayCalc.ts (미러)', () => {
  test('copayCalc.ts: 일반 정률경로(ELSE) = Math.floor (Math.ceil 잔존 금지)', () => {
    const src = fs.readFileSync(COPAY_CALC, 'utf-8');
    expect(src).toContain('Math.floor((base * rate) / 100) * 100');
    // 일반경로 CEIL 잔존 금지 (elderly 구간은 rate 리터럴이라 별개)
    expect(src).not.toContain('Math.ceil((base * rate) / 100) * 100');
  });

  test('RPC v1.5 마이그레이션: 일반 정률경로 FLOOR + CEIL 잔존 금지 + elderly 4구간 유지', () => {
    const sql = fs.readFileSync(RPC_MIG, 'utf-8');
    // 일반경로 FLOOR
    expect(sql).toContain('FLOOR((v_base * v_rate) / 100.0) * 100');
    // 일반경로 CEIL 완전 제거 (rollback 파일에만 존재)
    expect(sql).not.toContain('CEIL((v_base * v_rate) / 100.0) * 100');
    // elderly 4구간 FLOOR 회귀(무변경)
    expect(sql).toContain('FLOOR((v_base * 0.10) / 100.0) * 100');
    expect(sql).toContain('FLOOR((v_base * 0.20) / 100.0) * 100');
    expect(sql).toContain('FLOOR((v_base * 0.30) / 100.0) * 100');
    // governed·NULLFIX·의료급여1종 유지
    expect(sql).toContain('v_clinic.hira_unit_value IS NULL');
    expect(sql).toContain('LEAST(1000, v_base)');
    expect(sql).toContain('data_incomplete BOOLEAN');
    // ADDITIVE = CREATE OR REPLACE (DROP FUNCTION 없음)
    expect(sql).toContain('CREATE OR REPLACE FUNCTION calc_copayment');
    expect(sql).not.toMatch(/DROP\s+FUNCTION/i);
    // 규정 근거 인용(소명용)
    expect(sql).toContain('100원 미만');
    expect(sql).toContain('CIT-2026-001');
  });

  test('parity 값 일치: 일반경로 대표 케이스 copayCalc.ts = 규정 FLOOR (5+건)', () => {
    const cases: Array<[number, InsuranceGrade, number]> = [
      [29380, 'general', 8800],
      [12345, 'general', 3700],
      [100, 'general', 0],
      [10050, 'low_income_1', 1400],
      [10050, 'medical_aid_2', 1500],
      [10050, 'infant', 2100],
      [12345, 'unverified', 3700],
    ];
    for (const [base, grade, expected] of cases) {
      const rate = getBaseCopayRate(grade);
      expect(floor100(base, rate)).toBe(expected);                  // 규정식 검산
      expect(calcGeneral(base, grade).copayment_amount).toBe(expected); // 미러 일치
    }
  });
});
