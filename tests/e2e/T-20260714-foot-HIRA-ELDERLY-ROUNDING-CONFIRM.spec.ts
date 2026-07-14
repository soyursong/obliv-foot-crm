/**
 * E2E/unit spec — T-20260714-foot-HIRA-ELDERLY-ROUNDING-CONFIRM
 * 노인(elderly_flat) 외래 정률구간(10/20/30%) 원단위 = 100원 미만 절사(FLOOR) 확정 회귀.
 *
 * ★ SPEC 재정의: 종전 CEIL(100원 올림, v1.3) → FLOOR(100원 미만 절사, v1.4).
 * 규정 근거:
 *   · 국민건강보험법 시행령 별표2 제19조 제1항 "100원 미만은 제외한다" (법제처)
 *   · 심평원 외래 본인부담기준표 "100원미만 절사" (전 구분 동일)
 *   · 10원 절사 관행(베가스, 백승민)은 비급여/자보 혼재 추정 → 급여 외래와 별도, 폐기.
 *
 * SSOT: revenue_insurance_split_spec §2-2-3. 서버 RPC=단일권위, copayCalc.ts=미러(parity).
 * 정액 1,500원 구간(≤15k) 무영향 — 절사는 정률구간에만 적용.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { calcCopayment, type CopayCalcResult } from '../../src/lib/copayCalc';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const COPAY_CALC = path.join(ROOT, 'src/lib/copayCalc.ts');
const RPC_MIG = path.join(ROOT, 'supabase/migrations/20260714133000_calc_copayment_elderly_floor_rounding.sql');

// unit_value=1 → base = hira_score → 구간·절사 경계 정확 검증
function calcElderly(base: number, override: number | null = null): CopayCalcResult {
  return calcCopayment(
    { is_insurance_covered: true, hira_score: base, copayment_rate_override: override, price: 0 },
    { hira_unit_value: 1 },
    'elderly_flat',
  );
}

test.describe('T-20260714 ROUNDING-CONFIRM — 정률구간 100원 미만 절사(FLOOR)', () => {

  // ── ★ 절사 자체 회귀: 정수배 아닌 값(§4 핵심 케이스) ──────────────────────
  test('10% 구간: 수가 18,050 × 10% = 1,805 → 절사 1,800 (CEIL 1,900 아님)', () => {
    const r = calcElderly(18050);
    expect(r.data_incomplete).toBe(false);
    expect(r.copayment_amount).toBe(1800);
    expect(r.copayment_amount).not.toBe(1900); // 종전 CEIL 폐기
  });

  test('20% 구간: 수가 21,990 × 20% = 4,398 → 절사 4,300 (CEIL 4,400 아님)', () => {
    expect(calcElderly(21990).copayment_amount).toBe(4300);
    expect(calcElderly(21990).copayment_amount).not.toBe(4400);
  });

  test('30% 구간: 수가 27,010 × 30% = 8,103 → 절사 8,100 (CEIL 8,200 아님)', () => {
    expect(calcElderly(27010).copayment_amount).toBe(8100);
    expect(calcElderly(27010).copayment_amount).not.toBe(8200);
  });

  // ── 경계값 = 절사 (종전 CEIL 대비 100원 낮음) ───────────────────────────
  test('경계 15,001 → 1,500 (10원 아닌 100원 절사, CEIL 1,600 아님)', () => {
    expect(calcElderly(15001).copayment_amount).toBe(1500);
  });
  test('경계 20,001 → 4,000 (CEIL 4,100 아님)', () => {
    expect(calcElderly(20001).copayment_amount).toBe(4000);
  });
  test('경계 25,001 → 7,500 (CEIL 7,600 아님)', () => {
    expect(calcElderly(25001).copayment_amount).toBe(7500);
  });

  // ── AC 정수배 값: 절사 무관 통과 (기존 AC 회귀) ─────────────────────────
  test('AC 18,000 = 10% → 1,800 (정수배, 절사 무관)', () => {
    expect(calcElderly(18000).copayment_amount).toBe(1800);
  });
  test('AC 22,000 = 20% → 4,400 (정수배)', () => {
    expect(calcElderly(22000).copayment_amount).toBe(4400);
  });
  test('AC 27,000 = 30% → 8,100 (정수배)', () => {
    expect(calcElderly(27000).copayment_amount).toBe(8100);
  });

  // ── 정액 1,500 구간 무영향 (절사는 정률구간에만) ────────────────────────
  test('정액구간 ≤15k 무영향: 12,000 → 1,500 / 15,000 → 1,500', () => {
    expect(calcElderly(12000).copayment_amount).toBe(1500);
    expect(calcElderly(15000).copayment_amount).toBe(1500);
    // 정액구간엔 어떤 절사도 적용 안 됨
    expect(calcElderly(14999).copayment_amount).toBe(1500);
  });

  // ── override 있으면 4구간 미적용 (실손 자기부담률 우선, else 정률경로) ────
  test('override 시 4구간 미적용: base 18,000 × 0.5 = 9,000 (elderly 절사 경로 아님)', () => {
    expect(calcElderly(18000, 0.5).copayment_amount).toBe(9000);
  });
});

test.describe('T-20260714 ROUNDING-CONFIRM — parity (RPC 단일권위 ↔ copayCalc.ts 미러)', () => {

  test('copayCalc.ts: elderly 정률구간 3개 = Math.floor (Math.ceil 아님)', () => {
    const src = fs.readFileSync(COPAY_CALC, 'utf-8');
    // 노인 정률 3구간 모두 floor 절사
    expect(src).toContain('Math.floor((base * 0.10) / 100) * 100');
    expect(src).toContain('Math.floor((base * 0.20) / 100) * 100');
    expect(src).toContain('Math.floor((base * 0.30) / 100) * 100');
    // elderly 구간에 ceil 잔존 금지 (일반 else 경로의 ceil 은 별개)
    expect(src).not.toContain('Math.ceil((base * 0.10)');
    expect(src).not.toContain('Math.ceil((base * 0.20)');
    expect(src).not.toContain('Math.ceil((base * 0.30)');
  });

  test('RPC v1.4 마이그레이션: elderly 정률구간 FLOOR + CEIL 잔존 금지', () => {
    const sql = fs.readFileSync(RPC_MIG, 'utf-8');
    expect(sql).toContain('FLOOR((v_base * 0.10) / 100.0) * 100');
    expect(sql).toContain('FLOOR((v_base * 0.20) / 100.0) * 100');
    expect(sql).toContain('FLOOR((v_base * 0.30) / 100.0) * 100');
    // elderly 정률구간에 CEIL 없음 (일반 else 경로 CEIL 은 별개 라인)
    expect(sql).not.toContain('CEIL((v_base * 0.10)');
    expect(sql).not.toContain('CEIL((v_base * 0.20)');
    expect(sql).not.toContain('CEIL((v_base * 0.30)');
    // 4구간·governed·NULLFIX 유지 회귀
    expect(sql).toMatch(/v_base\s*<=\s*15000/);
    expect(sql).toContain('v_clinic.hira_unit_value IS NULL');
    expect(sql).toContain('data_incomplete BOOLEAN');
    // 규정 근거 인용(소명용)
    expect(sql).toContain('100원 미만');
  });

  test('parity 값 일치: 대표 케이스 copayCalc.ts 산출 = 규정 절사값', () => {
    // FLOOR 규정 = Math.floor((base*rate)/100)*100
    const cases: Array<[number, number, number]> = [
      [18050, 0.10, 1800],
      [21990, 0.20, 4300],
      [27010, 0.30, 8100],
      [15001, 0.10, 1500],
      [20001, 0.20, 4000],
      [25001, 0.30, 7500],
    ];
    for (const [base, rate, expected] of cases) {
      expect(Math.floor((base * rate) / 100) * 100).toBe(expected); // 규정식 검산
      expect(calcElderly(base).copayment_amount).toBe(expected);    // 미러 일치
    }
  });
});
