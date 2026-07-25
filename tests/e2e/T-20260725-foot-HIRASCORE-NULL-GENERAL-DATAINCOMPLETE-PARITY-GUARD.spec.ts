/**
 * E2E/unit spec — T-20260725-foot-HIRASCORE-NULL-GENERAL-DATAINCOMPLETE-PARITY-GUARD
 *
 * general 등급 급여서비스 × hira_score NULL 의 '무경고 정가부과' 재발 예방 가드.
 * 설계게이트 = DA CONSULT-REPLY (2026-07-25, MSG-20260725-193942-ci9q):
 *   판정1 (core GO)     : 급여×hira_score NULL → data_incomplete=TRUE 를 grade-universal 진실로(general 포함).
 *   판정2 (★CRITICAL·⚠BINDING severity):
 *     · capped(차상위/의료급여/노인정액)·등급미상 → hard-BLOCK 유지(§2-2-1b 불변, 환수불가 harm).
 *     · general/grade=null → WARN(정가 임시부과 + '데이터미비' 배지) + 환수-safe fallback 진행 허용.
 *     · 단일 data_incomplete gate 오용 방지 → 플래그가 severity(data_incomplete_block)를 실어야 함.
 *   판정3 (phantom 공단 금지): general fallback = covered=0, copay=price-full. 70% 공단 하드코딩 절대금지.
 *   판정4 (PRIMARY 진원차단): 급여서비스 저장시점 soft-warn(hard-block 아님, admin 스테이징 허용).
 *
 * SSOT: 서버 RPC calc_copayment = 단일권위(db_change=false 로 본 티켓 무접촉),
 *       copayCalc.ts = 클라 미러 — 본 가드의 honest 플래그 정정 locus.
 * 방어심도: L1 생성 soft-warn(Services.tsx) → L2 charge data_incomplete(copayCalc.ts) → L3 capped BLOCK(기존) → 배지(panels).
 *
 * 실행: npx playwright test T-20260725-foot-HIRASCORE-NULL-GENERAL-DATAINCOMPLETE-PARITY-GUARD.spec.ts
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { calcCopayment, type CopayCalcResult } from '../../src/lib/copayCalc';
import type { InsuranceGrade } from '../../src/lib/insurance';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const COPAY_CALC = path.join(ROOT, 'src/lib/copayCalc.ts');
const SERVICES = path.join(ROOT, 'src/pages/Services.tsx');
const PANEL_CHART2 = path.join(ROOT, 'src/components/insurance/Chart2InsuranceCalcPanel.tsx');
const PANEL_ICP = path.join(ROOT, 'src/components/insurance/InsuranceCopaymentPanel.tsx');

/** 급여서비스 × hira_score NULL 케이스 (price=정가 fallback). */
function calcNullScore(grade: InsuranceGrade, price = 30000): CopayCalcResult {
  return calcCopayment(
    { is_insurance_covered: true, hira_score: null, copayment_rate_override: null, price },
    { hira_unit_value: 95.6 },
    grade,
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 판정0 (⚠BINDING) — severity carrier 존재 & grade-aware 분기 실증
// ══════════════════════════════════════════════════════════════════════════
test.describe('⚠BINDING — data_incomplete 는 severity(block/warn)를 실어야 한다', () => {
  test('CopayCalcResult 에 data_incomplete_block 필드 존재 (severity carrier)', () => {
    const r = calcNullScore('general');
    expect(r).toHaveProperty('data_incomplete_block');
    expect(typeof r.data_incomplete_block).toBe('boolean');
  });

  test('naive parity 잠입 방지: general(WARN) 과 capped(BLOCK) 가 동일 data_incomplete=TRUE 라도 severity 로 분리된다', () => {
    const g = calcNullScore('general');
    const c = calcNullScore('medical_aid_1');
    expect(g.data_incomplete).toBe(true);
    expect(c.data_incomplete).toBe(true);
    // 같은 data_incomplete=TRUE 인데 severity 는 반대 → 단일 gate 로 general 을 hard-block 잠입시키지 않음
    expect(g.data_incomplete_block).toBe(false);
    expect(c.data_incomplete_block).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 판정1·2·3 (L2 charge-time) — general/grade=null = WARN + 환수-safe fallback
// ══════════════════════════════════════════════════════════════════════════
test.describe('general 급여 × hira_score NULL → data_incomplete=TRUE·WARN, 정가 fallback', () => {
  test('general → TRUE·block=false, copay=정가(price-full), covered=0 (phantom 공단 금지)', () => {
    const r = calcNullScore('general', 30000);
    expect(r.data_incomplete).toBe(true);         // 판정1: honest parity
    expect(r.data_incomplete_block).toBe(false);  // 판정2: WARN (hard-lockout 금지)
    expect(r.copayment_amount).toBe(30000);        // 판정3: 정가 임시부과 (환수-safe)
    expect(r.insurance_covered_amount).toBe(0);    // 판정3: 70% 공단 하드코딩 금지 → covered=0
    expect(r.applied_rate).toBe(1.0);
  });

  test('WARN fallback 은 정가 무손실 (price 그대로 본인부담)', () => {
    expect(calcNullScore('general', 12345).copayment_amount).toBe(12345);
    expect(calcNullScore('general', 12345).insurance_covered_amount).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 판정2 불변 — capped = hard-BLOCK 유지 (§2-2-1b), 금액 날조 금지
// ══════════════════════════════════════════════════════════════════════════
test.describe('capped/등급미상 급여 × hira_score NULL → hard-BLOCK 유지 (무변경)', () => {
  const capped: InsuranceGrade[] = [
    'low_income_1', 'low_income_2', 'medical_aid_1', 'medical_aid_2', 'elderly_flat', 'infant', 'unverified',
  ];
  for (const grade of capped) {
    test(`${grade} → data_incomplete=TRUE·block=true, 모든 금액 0`, () => {
      const r = calcNullScore(grade);
      expect(r.data_incomplete).toBe(true);
      expect(r.data_incomplete_block).toBe(true);  // hard-BLOCK 유지
      expect(r.base_amount).toBe(0);
      expect(r.copayment_amount).toBe(0);
      expect(r.insurance_covered_amount).toBe(0);
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 회귀 (AC3) — 정상 급여계산·비급여 정가부과 무변경
// ══════════════════════════════════════════════════════════════════════════
test.describe('회귀 — score 보유 급여계산 / 비급여 정가부과 무변경', () => {
  test('active 급여서비스(score 보유) general 30% 정상 산출 무변경 (data_incomplete=false)', () => {
    // hira_unit_value=1 → base=hira_score. 29,380 × 30% = 8,814 → FLOOR 8,800.
    const r = calcCopayment(
      { is_insurance_covered: true, hira_score: 29380, copayment_rate_override: null, price: 0 },
      { hira_unit_value: 1 },
      'general',
    );
    expect(r.data_incomplete).toBe(false);
    expect(r.data_incomplete_block).toBe(false);
    expect(r.copayment_amount).toBe(8800);
    expect(r.insurance_covered_amount).toBe(29380 - 8800);
  });

  test('capped(medical_aid_1) score 보유 → 정액 1,000 정상 무변경', () => {
    const r = calcCopayment(
      { is_insurance_covered: true, hira_score: 29380, copayment_rate_override: null, price: 0 },
      { hira_unit_value: 1 },
      'medical_aid_1',
    );
    expect(r.data_incomplete).toBe(false);
    expect(r.data_incomplete_block).toBe(false);
    expect(r.copayment_amount).toBe(1000);
  });

  test('비급여(is_insurance_covered=false) → 전액 정가부과 무변경 (data_incomplete=false)', () => {
    const r = calcCopayment(
      { is_insurance_covered: false, hira_score: null, copayment_rate_override: null, price: 20000 },
      { hira_unit_value: 95.6 },
      'general',
    );
    expect(r.data_incomplete).toBe(false);       // 급여 근거 미비 아님 → 배지·경고 없음
    expect(r.data_incomplete_block).toBe(false);
    expect(r.copayment_amount).toBe(20000);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 소스 정합 — L1 저장 soft-warn(진원차단) + 배지(charge-time 가시화)
// ══════════════════════════════════════════════════════════════════════════
test.describe('방어심도 소스 정합 — 저장 soft-warn + 수납 배지', () => {
  test('copayCalc.ts: general NULL 분기가 data_incomplete_block=false(WARN)를 명시', () => {
    const src = fs.readFileSync(COPAY_CALC, 'utf-8');
    expect(src).toContain('data_incomplete_block');
    expect(src).toMatch(/data_incomplete:\s*true,[\s\S]*?data_incomplete_block:\s*false/); // general WARN 경로
  });

  test('Services.tsx: 저장시점 급여×hira_score NULL soft-warn (진원차단, hard-block 아님)', () => {
    const src = fs.readFileSync(SERVICES, 'utf-8');
    expect(src).toContain('is_insurance_covered');
    expect(src).toContain('hira_score == null');
    expect(src).toContain('정가로 임시 부과');
  });

  test('수납 패널(Chart2·ICP): 급여×hira_score NULL 데이터미비 배지 렌더', () => {
    const c2 = fs.readFileSync(PANEL_CHART2, 'utf-8');
    const icp = fs.readFileSync(PANEL_ICP, 'utf-8');
    expect(c2).toMatch(/is_insurance_covered\s*&&\s*svc\.hira_score\s*==\s*null/);
    expect(c2).toContain('데이터미비');
    expect(icp).toMatch(/is_insurance_covered\s*&&\s*svc\.hira_score\s*==\s*null/);
    expect(icp).toContain('데이터미비');
  });
});
