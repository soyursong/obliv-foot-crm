/**
 * T-20260730-foot-INS-GRADE-LABEL-RECONCILE
 *
 * 건보 자격등급 라벨/주석 정본화 — 계산 무변경(label-layer only).
 *
 * 배경: 화면 패널2 + 손님 서류토큰에 자격등급이 옛 오적용 %값(차상위 14%·의급2 15%)으로
 *   표시됐다. 실 청구(copayCalc.ts / RPC calc_copayment v1.6)는 이미 정본(면제=0원 / 정액 1,000원).
 *   표시 라벨만 옛값 잔존 → INSURANCE_GRADE_LABELS(SSOT) 한 곳 정정 = 패널2+서류토큰 자동반영.
 *
 * SSOT 소비경로(정정 자동전파 검증):
 *   INSURANCE_GRADE_LABELS →
 *     · 패널2: Chart2InsuranceCalcPanel.tsx / InsuranceCopaymentPanel.tsx (gradeLabel)
 *     · 서류토큰: autoBindContext.ts (gradeLabel 바인딩)
 *
 * AC-2(능동 검증): 각 신규 라벨 = copayCalc.ts 실 산출값과 대조("라벨=실제 청구" 일치).
 * AC-4(무변경): 계산 로직(copayCalc.ts/RPC) 무접촉 — 본인부담금 금액 불변(라벨만 변경).
 *
 * 순수 로직 + 정적 소스 가드(auth/server/DB 불요, 결정론). 진짜 게이트 = 패널2·서류 실렌더(supervisor field-soak).
 * 실행: npx playwright test T-20260730-foot-INS-GRADE-LABEL-RECONCILE.spec.ts --project=unit
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  INSURANCE_GRADE_LABELS,
  INSURANCE_GRADE_SHORT_LABELS,
  type InsuranceGrade,
} from '../../src/lib/insurance';
import { calcCopayment, getBaseCopayRate, type CopayCalcResult } from '../../src/lib/copayCalc';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PANEL_CHART2 = path.join(ROOT, 'src/components/insurance/Chart2InsuranceCalcPanel.tsx');
const PANEL_COPAY = path.join(ROOT, 'src/components/insurance/InsuranceCopaymentPanel.tsx');
const AUTOBIND = path.join(ROOT, 'src/lib/autoBindContext.ts');

// unit_value=1 → base = hira_score. 급여건 실 산출값(copay) 확인용.
function calc(base: number, grade: InsuranceGrade): CopayCalcResult {
  return calcCopayment(
    { is_insurance_covered: true, hira_score: base, copayment_rate_override: null, price: 0 },
    { hira_unit_value: 1 },
    grade,
  );
}

// ── 시나리오1·2·3: 패널2 + 서류토큰 라벨 정본 (INSURANCE_GRADE_LABELS SSOT) ─────────
test.describe('T-20260730 자격등급 라벨 정본 (SSOT INSURANCE_GRADE_LABELS)', () => {
  test('차상위 1종 → "차상위 1종 (면제)" (종전 14% 폐기)', () => {
    expect(INSURANCE_GRADE_LABELS.low_income_1).toBe('차상위 1종 (면제)');
    expect(INSURANCE_GRADE_LABELS.low_income_1).not.toContain('14%');
  });
  test('차상위 2종 → "차상위 2종 (정액 1,000원)" (종전 14% 폐기)', () => {
    expect(INSURANCE_GRADE_LABELS.low_income_2).toBe('차상위 2종 (정액 1,000원)');
    expect(INSURANCE_GRADE_LABELS.low_income_2).not.toContain('14%');
  });
  test('의료급여 2종 → "의료급여 2종 (정액 1,000원)" (종전 15% 폐기)', () => {
    expect(INSURANCE_GRADE_LABELS.medical_aid_2).toBe('의료급여 2종 (정액 1,000원)');
    expect(INSURANCE_GRADE_LABELS.medical_aid_2).not.toContain('15%');
  });

  // 무접촉 회귀(이미 정확 — 정정 대상 아님): 의급1·general·infant·foreigner
  test('무접촉 회귀: 의료급여 1종/일반/6세미만/외국인 라벨 불변', () => {
    expect(INSURANCE_GRADE_LABELS.medical_aid_1).toBe('의료급여 1종 (정액 1,000원)');
    expect(INSURANCE_GRADE_LABELS.general).toBe('일반 (30%)');
    expect(INSURANCE_GRADE_LABELS.infant).toBe('만6세 미만 (21%)');
    expect(INSURANCE_GRADE_LABELS.foreigner).toBe('외국인 (비급여)');
  });

  // elderly_flat: 4구간 정률제라 단일 정액표기 부정확 → '정률제' 정본(현장 권고 반영).
  test('만65세 → "만65세 노인 (정률제)" (단일 "정액 1,500원" 부정확 정정)', () => {
    expect(INSURANCE_GRADE_LABELS.elderly_flat).toBe('만65세 노인 (정률제)');
    expect(INSURANCE_GRADE_LABELS.elderly_flat).not.toContain('1,500');
  });

  // SHORT_LABELS: %가 없어 정정 불필요 — 무변경 확인.
  test('SHORT_LABELS 무변경(% 미포함)', () => {
    for (const g of Object.keys(INSURANCE_GRADE_SHORT_LABELS) as InsuranceGrade[]) {
      expect(INSURANCE_GRADE_SHORT_LABELS[g]).not.toContain('%');
    }
    expect(INSURANCE_GRADE_SHORT_LABELS.low_income_1).toBe('차상위1');
    expect(INSURANCE_GRADE_SHORT_LABELS.medical_aid_2).toBe('의료급여2');
  });
});

// ── AC-2 능동 검증: 라벨 = 실제 청구(copayCalc) 일치 ────────────────────────────
test.describe('T-20260730 AC-2 — 라벨=실제 청구 대조 (copayCalc 실 산출값)', () => {
  test('차상위 1종 라벨 "면제" ↔ 실 copay 0원', () => {
    const r = calc(13710, 'low_income_1');
    expect(r.copayment_amount).toBe(0);                 // 면제
    expect(r.insurance_covered_amount).toBe(13710);     // 공단 = base 전액
    expect(getBaseCopayRate('low_income_1')).toBe(0);
  });
  test('차상위 2종 라벨 "정액 1,000원" ↔ 실 copay MIN(1000,base)', () => {
    expect(calc(13710, 'low_income_2').copayment_amount).toBe(1000);
    expect(calc(800, 'low_income_2').copayment_amount).toBe(800); // base<1000 → base
    expect(getBaseCopayRate('low_income_2')).toBe(0);
  });
  test('의료급여 2종 라벨 "정액 1,000원" ↔ 실 copay MIN(1000,base)', () => {
    expect(calc(13710, 'medical_aid_2').copayment_amount).toBe(1000);
    expect(getBaseCopayRate('medical_aid_2')).toBe(0);
  });
  // NOTE 대조: 의급1·의급2 모두 정액 1,000원 — 두 급여등급 정액표기가 실 청구정책과 일치.
  test('의급1 = 의급2 = 정액 1,000원 (두 급여등급 정액표기 정합)', () => {
    expect(calc(13710, 'medical_aid_1').copayment_amount).toBe(1000);
    expect(calc(13710, 'medical_aid_2').copayment_amount).toBe(1000);
  });
});

// ── 시나리오4 + AC-4: 계산 무변경(라벨만) — 본인부담금 금액 불변 ───────────────────
test.describe('T-20260730 AC-4 — 계산 무변경(금액 불변)', () => {
  // 라벨 정정과 무관하게 각 등급 본인부담금은 v1.6 정본 그대로여야 한다(라벨 layer only).
  const EXPECTED: Array<[InsuranceGrade, number, number]> = [
    ['general', 13710, 4100],       // FLOOR(13710*0.3)
    ['low_income_1', 13710, 0],     // 면제
    ['low_income_2', 13710, 1000],  // 정액
    ['medical_aid_1', 13710, 1000], // 정액
    ['medical_aid_2', 13710, 1000], // 정액
    ['infant', 13710, 2800],        // FLOOR(13710*0.21)
  ];
  for (const [grade, base, copay] of EXPECTED) {
    test(`${grade}: base ${base} → copay ${copay} (라벨 정정 전후 동일)`, () => {
      expect(calc(base, grade).copayment_amount).toBe(copay);
    });
  }

  // copayCalc.ts 정본 분기 잔존 가드(계산 로직 무접촉 = 14%/15% 정률 복귀 금지).
  test('copayCalc.ts 정액/면제 분기 잔존 (14%/15% 정률 복귀 금지)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/lib/copayCalc.ts'), 'utf-8');
    expect(src).toContain("if (grade === 'low_income_1') return 0;");           // 면제
    expect(src).toContain('return Math.min(1000, base);');                       // 정액
    expect(src).not.toContain('return 0.14;');                                   // 옛 정률 부재
    expect(src).not.toContain('return 0.15;');
  });
});

// ── SSOT 자동전파 소스 가드: 패널2 + 서류토큰이 INSURANCE_GRADE_LABELS 를 소비 ──────
test.describe('T-20260730 SSOT 소비경로 — 한 곳 정정 → 패널2+서류토큰 자동반영', () => {
  test('패널2(Chart2InsuranceCalcPanel) gradeLabel = INSURANCE_GRADE_LABELS 소비', () => {
    const src = fs.readFileSync(PANEL_CHART2, 'utf-8');
    expect(src).toContain('INSURANCE_GRADE_LABELS');
    expect(src).toMatch(/INSURANCE_GRADE_LABELS\[/);
  });
  test('패널2(InsuranceCopaymentPanel) gradeLabel = INSURANCE_GRADE_LABELS 소비', () => {
    const src = fs.readFileSync(PANEL_COPAY, 'utf-8');
    expect(src).toContain('INSURANCE_GRADE_LABELS');
    expect(src).toMatch(/INSURANCE_GRADE_LABELS\[/);
  });
  test('서류토큰(autoBindContext) gradeLabel = INSURANCE_GRADE_LABELS 소비', () => {
    const src = fs.readFileSync(AUTOBIND, 'utf-8');
    expect(src).toContain('INSURANCE_GRADE_LABELS');
    expect(src).toMatch(/gradeLabel:\s*INSURANCE_GRADE_LABELS\[/);
  });
});
