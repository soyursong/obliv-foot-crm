/**
 * E2E/unit spec — T-20260713-foot-HIRA-UNIT-VALUE-2026-UPDATE
 * 풋 급여 수가 계산 오류 2건 수정 (급여 회귀, E2E 면제 해제)
 *
 * 이슈1: 점당단가 governed화 — 89.4 하드코딩 fallback 전면 제거, NULL→data_incomplete BLOCK.
 * 이슈2: 65세(elderly_flat) 외래 정률제 4구간 (§2-2-3).
 *   ≤15,000=정액 1,500 / ~20,000=10% / ~25,000=20% / >25,000=30%  (★제보 3구간 오류 검증)
 *
 * SSOT: revenue_insurance_split_spec v1.10 §2-2-0/1/3. 서버 RPC=단일권위, copayCalc.ts=미러.
 * NULLFIX(v1.2 default-deny) 흡수(subsume) 확인 포함.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { calcCopayment, type CopayCalcResult } from '../../src/lib/copayCalc';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const COPAY_CALC = path.join(ROOT, 'src/lib/copayCalc.ts');
const RPC_MIG = path.join(ROOT, 'supabase/migrations/20260714120000_calc_copayment_hira_governed_elderly_tiers.sql');
const SEED_MIG = path.join(ROOT, 'supabase/migrations/20260714110000_clinics_hira_unit_value_2026_governed.sql');

// unit_value=1 로 두면 base = hira_score → 구간 경계 정확 검증
function calcElderly(base: number, override: number | null = null): CopayCalcResult {
  return calcCopayment(
    { is_insurance_covered: true, hira_score: base, copayment_rate_override: override, price: 0 },
    { hira_unit_value: 1 },
    'elderly_flat',
  );
}

test.describe('T-20260713 HIRA-UNIT-VALUE-2026 — 이슈2: 65세 4구간 정률제', () => {

  // ── AC 필수 테스트케이스 ─────────────────────────────────────────────
  test('AC: 수가 18,000원 = 10% → 1,800 (제보 20% 오류 검증)', () => {
    const r = calcElderly(18000);
    expect(r.data_incomplete).toBe(false);
    expect(r.copayment_amount).toBe(1800);
    expect(r.copayment_amount).not.toBe(3600); // 제보 20% 아님
    expect(r.copayment_amount).not.toBe(5400); // 기존 30% 아님
  });

  test('AC: 수가 22,000원 = 20% → 4,400', () => {
    expect(calcElderly(22000).copayment_amount).toBe(4400);
  });

  test('AC: 수가 27,000원 = 30% → 8,100', () => {
    expect(calcElderly(27000).copayment_amount).toBe(8100);
  });

  test('AC: 수가 12,000원 = 정액 1,500', () => {
    expect(calcElderly(12000).copayment_amount).toBe(1500);
  });

  // ── 구간 경계 ────────────────────────────────────────────────────────
  test('경계: 15,000 이하 = 정액 1,500', () => {
    expect(calcElderly(15000).copayment_amount).toBe(1500);
  });
  test('경계: 15,001 = 10% 구간 진입', () => {
    expect(calcElderly(15001).copayment_amount).toBe(Math.ceil((15001 * 0.10) / 100) * 100); // 1600
  });
  test('경계: 20,000 = 10% (2,000)', () => {
    expect(calcElderly(20000).copayment_amount).toBe(2000);
  });
  test('경계: 20,001 = 20% 구간 진입', () => {
    expect(calcElderly(20001).copayment_amount).toBe(Math.ceil((20001 * 0.20) / 100) * 100); // 4100
  });
  test('경계: 25,000 = 20% (5,000)', () => {
    expect(calcElderly(25000).copayment_amount).toBe(5000);
  });
  test('경계: 25,001 = 30% 구간 진입', () => {
    expect(calcElderly(25001).copayment_amount).toBe(Math.ceil((25001 * 0.30) / 100) * 100); // 7600
  });

  test('override 있으면 4구간 미적용 (실손 자기부담률 우선)', () => {
    // base=18000, override 0.5 → 정률경로 → ceil(9000/100)*100 = 9000 (10% 구간 아님)
    const r = calcElderly(18000, 0.5);
    expect(r.copayment_amount).toBe(9000);
  });
});

test.describe('T-20260713 HIRA-UNIT-VALUE-2026 — 이슈1: 점당단가 governed', () => {

  test('hira_unit_value NULL → data_incomplete BLOCK (89.4 fallback 없음)', () => {
    const r = calcCopayment(
      { is_insurance_covered: true, hira_score: 150, copayment_rate_override: null, price: 0 },
      { hira_unit_value: null },
      'general',
    );
    expect(r.data_incomplete).toBe(true);
    expect(r.base_amount).toBe(0);
    expect(r.copayment_amount).toBe(0);
    expect(r.insurance_covered_amount).toBe(0);
    expect(r.applied_rate).toBe(0);
  });

  test('hira_unit_value 세팅 시 정상 산출 (95.6 governed)', () => {
    // 초진 진찰료 153.36점 × 95.6 = 14661 (일반 30% → ceil(4398.3/100)*100 = 4400)
    const r = calcCopayment(
      { is_insurance_covered: true, hira_score: 153.36, copayment_rate_override: null, price: 0 },
      { hira_unit_value: 95.6 },
      'general',
    );
    expect(r.data_incomplete).toBe(false);
    expect(r.base_amount).toBe(Math.round(153.36 * 95.6)); // 14661
    expect(r.applied_rate).toBe(0.30);
  });
});

test.describe('T-20260713 — NULLFIX v1.2 default-deny 흡수(subsume) 회귀', () => {
  test('급여+hira_score NULL + general → 전액본인부담 fallback (data_incomplete=false)', () => {
    const r = calcCopayment(
      { is_insurance_covered: true, hira_score: null, copayment_rate_override: null, price: 30000 },
      { hira_unit_value: 95.6 },
      'general',
    );
    expect(r.data_incomplete).toBe(false);
    expect(r.copayment_amount).toBe(30000);
  });

  test('급여+hira_score NULL + low_income_1 → default-deny BLOCK', () => {
    const r = calcCopayment(
      { is_insurance_covered: true, hira_score: null, copayment_rate_override: null, price: 30000 },
      { hira_unit_value: 95.6 },
      'low_income_1',
    );
    expect(r.data_incomplete).toBe(true);
    expect(r.copayment_amount).toBe(0);
  });

  test('비급여 → 전액 본인부담 (data_incomplete=false, 회귀 무변경)', () => {
    const r = calcCopayment(
      { is_insurance_covered: false, hira_score: null, copayment_rate_override: null, price: 20000 },
      { hira_unit_value: 95.6 },
      'general',
    );
    expect(r.data_incomplete).toBe(false);
    expect(r.copayment_amount).toBe(20000);
  });
});

test.describe('T-20260713 — 소스/마이그레이션 정합 (서버=단일권위, 클라=미러)', () => {

  test('copayCalc.ts: 89.4 하드코딩 fallback 제거됨', () => {
    const src = fs.readFileSync(COPAY_CALC, 'utf-8');
    expect(src).not.toContain('?? 89.4');
    expect(src).not.toMatch(/hira_unit_value\s*\?\?\s*89\.4/);
    expect(src).toContain('data_incomplete');
  });

  test('RPC 마이그레이션: COALESCE(...,89.4) 숫자 fallback 제거 + 4구간 존재', () => {
    const sql = fs.readFileSync(RPC_MIG, 'utf-8');
    // 정상분기 base 산출에서 COALESCE 89.4 제거 (rollback 파일 제외)
    expect(sql).not.toMatch(/COALESCE\(\s*v_clinic\.hira_unit_value\s*,\s*89\.4\s*\)/);
    // hira_unit_value NULL → data_incomplete BLOCK
    expect(sql).toContain('v_clinic.hira_unit_value IS NULL');
    // 4구간 정률 존재
    expect(sql).toMatch(/v_base\s*<=\s*15000/);
    expect(sql).toMatch(/v_base\s*<=\s*20000/);
    expect(sql).toMatch(/v_base\s*<=\s*25000/);
    expect(sql).toContain('* 0.10');
    expect(sql).toContain('* 0.20');
    expect(sql).toContain('* 0.30');
    expect(sql).toContain('data_incomplete BOOLEAN'); // NULLFIX v1.2 반환형 흡수
  });

  test('seed 마이그레이션: 95.6 / 2026 governed + default 제거', () => {
    const sql = fs.readFileSync(SEED_MIG, 'utf-8');
    expect(sql).toContain('95.6');
    expect(sql).toContain('2026');
    expect(sql).toContain('DROP DEFAULT');
    expect(sql).toMatch(/hira_unit_value IS NULL/); // cutover NULL 0건 게이트
  });
});
