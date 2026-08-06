/**
 * T-20260807-foot-COPAY-INFANT-5PCT-LIVE-WIRING
 *
 * 1세미만 영유아 본인부담 5% **라이브 배선** 완성 (부모 T-20260720-foot-COPAY-AGE-DERIVED-AUTO 스핀오프).
 *   나이 판정 SSOT(customerAge.deriveAgeCopayGrade)는 만0세 5%를 이미 정확판정(부모 AC-4 unit PASS)했으나,
 *   라이브 rate 배선이 grade='infant'→21%(getBaseCopayRate, 6세미만 공통값)로 수렴 → 만0세 5% 미배선.
 *   본 티켓 = effectiveCopayRate 단일 헬퍼로 나이 파생 세부율(만0세 0.05 / 만1~5세 0.21)을 라이브 정률에 배선.
 *
 * 검증 축(순수 로직 + 정적 소스 가드, --project=unit, auth/DB 불요·결정론):
 *   AC-1 : 만0세(ageInfantRate=0.05) 라이브 계산경로 → 본인부담률 5% (21% 아님)
 *   AC-2 : 만5세(ageInfantRate=0.21) → 21% 유지(회귀 무손상)
 *   AC-3 : 만6세+ (general) → 30% 유지(ageInfantRate 무영향)
 *   회귀  : 정액/면제 등급(차상위·의급)·저장 charge 등급 폴백(infant→21%) 무손상
 *   배선  : loadEffectiveInsuranceGradeEx → infantCopayRate 동반 / PMW ageInfantRate pass-through / db_change 0
 *
 * db_change=false: 서버 RPC calc_copayment(stored grade 미러)는 미접촉 — 나이 파생 rate 배선은 FE 전용
 *   (부모 db_change=false scope 계승). infant 는 정률경로라 rate 보정만으로 5% 라이브(RPC/스키마 확장 불요).
 *
 * 진짜 게이트(라이브 청구 반영) = supervisor field-soak. 단 풋 만1세미만 내원 극희소(P3 backlog).
 * 실행: npx playwright test T-20260807-foot-COPAY-INFANT-5PCT-LIVE-WIRING.spec.ts --project=unit
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  effectiveCopayRate,
  computeFootBilling,
  type FootBillingItem,
} from '../../src/lib/footBilling';
import { getBaseCopayRate } from '../../src/lib/copayCalc';
import { deriveAgeCopayGrade } from '../../src/lib/customerAge';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const FOOTBILLING = path.join(ROOT, 'src/lib/footBilling.ts');
const PMW = path.join(ROOT, 'src/components/PaymentMiniWindow.tsx');
const read = (p: string) => fs.readFileSync(p, 'utf8');

const TODAY = '2026-08-07';

// 급여 진찰료 항목 — base = ROUND(153.36 × 89.4) = 13,710 (부모 AC-5 케이스 재사용).
const CLINIC_UNIT = 89.4;
function coveredConsultItem(): FootBillingItem {
  return {
    service: {
      id: 'svc-consult',
      name: '초진 진찰료',
      hira_code: 'AA154',
      hira_score: 153.36,
      is_insurance_covered: true,
      price: 0,
    },
    qty: 1,
    unitPrice: 0,
  };
}
const BASE = Math.round(153.36 * CLINIC_UNIT); // 13,710
// copayFromBase 정률경로: FLOOR(base × rate / 100) × 100 (100원 미만 절사)
const floorCopay = (rate: number) => Math.min(Math.floor((BASE * rate) / 100) * 100, BASE);

// ── AC-1~3: effectiveCopayRate 라이브 정률 배선 (SSOT 헬퍼) ─────────────────────
test.describe('effectiveCopayRate — 나이 파생 infant 세부율 라이브 배선', () => {
  test('AC-1: 만0세(ageInfantRate=0.05) → 정률 0.05 (21% 아님)', () => {
    expect(effectiveCopayRate('infant', 0.05)).toBe(0.05);
    // 나이 판정 SSOT 자체가 만0세 → 0.05 (라이브 소스 정합)
    expect(deriveAgeCopayGrade('2026-06-10', TODAY)).toEqual(
      expect.objectContaining({ grade: 'infant', rate: 0.05 }),
    );
  });

  test('AC-2: 만5세(ageInfantRate=0.21) → 정률 0.21 (회귀 무손상)', () => {
    expect(effectiveCopayRate('infant', 0.21)).toBe(0.21);
    expect(deriveAgeCopayGrade('2021-01-10', TODAY)).toEqual(
      expect.objectContaining({ grade: 'infant', rate: 0.21 }),
    );
  });

  test('AC-3: general(만6세+) → 0.30, ageInfantRate 무영향', () => {
    expect(effectiveCopayRate('general', 0.05)).toBe(0.30);
    expect(effectiveCopayRate('general', null)).toBe(0.30);
    // 만6세 = 나이 특례 없음 → 나이 파생 null(일반 위임)
    expect(deriveAgeCopayGrade('2020-01-10', TODAY)).toBeNull();
  });

  test('저장 charge 등급 폴백 정합: infant + ageInfantRate 미전달 → getBaseCopayRate(21%)', () => {
    // 과거 21%로 확정 적재된 stored grade='infant' 는 세부율 미부여(forward-only). 21% 유지.
    expect(effectiveCopayRate('infant', null)).toBe(getBaseCopayRate('infant'));
    expect(effectiveCopayRate('infant', undefined)).toBe(0.21);
  });

  test('정액/면제 등급은 ageInfantRate 무관 (getBaseCopayRate 정보성)', () => {
    // low_income_1(면제)/의급(정액)은 copayFromBase 가 정본 — rate 는 정보성. 배선 무영향.
    expect(effectiveCopayRate('low_income_1', 0.05)).toBe(0.00);
    expect(effectiveCopayRate('medical_aid_1', 0.05)).toBe(0.00);
  });

  test('비-급여 등급/미상 → null (회귀 0)', () => {
    expect(effectiveCopayRate(null, 0.05)).toBeNull();
    expect(effectiveCopayRate('unverified', 0.05)).toBeNull();
    expect(effectiveCopayRate('foreigner', 0.05)).toBeNull();
  });
});

// ── computeFootBilling 라이브 계산경로 재현 (실 청구 grain) ──────────────────────
test.describe('computeFootBilling — 만0세 5% 라이브 실계산 (base 13,710)', () => {
  test('AC-1 라이브 재현: infant + ageInfantRate=0.05 → 본인부담 600원 (5%)', () => {
    const r = computeFootBilling([coveredConsultItem()], 'infant', {
      hiraUnitValue: CLINIC_UNIT,
      ageInfantRate: 0.05,
    });
    expect(r.coveredTotal).toBe(BASE);
    expect(r.copaymentTotal).toBe(floorCopay(0.05)); // 600 — 21%(2,800) 아님
    expect(r.copaymentTotal).toBe(600);
  });

  test('AC-2 회귀: infant + ageInfantRate=0.21 → 2,800원 (6세미만 공통)', () => {
    const r = computeFootBilling([coveredConsultItem()], 'infant', {
      hiraUnitValue: CLINIC_UNIT,
      ageInfantRate: 0.21,
    });
    expect(r.copaymentTotal).toBe(2800);
  });

  test('폴백 무손상: infant + ageInfantRate 미전달 → 2,800원 (getBaseCopayRate 21%)', () => {
    const r = computeFootBilling([coveredConsultItem()], 'infant', {
      hiraUnitValue: CLINIC_UNIT,
    });
    expect(r.copaymentTotal).toBe(2800);
  });

  test('AC-3 회귀: general → 4,100원 (30%), ageInfantRate 무영향', () => {
    const withRate = computeFootBilling([coveredConsultItem()], 'general', {
      hiraUnitValue: CLINIC_UNIT,
      ageInfantRate: 0.05,
    });
    const without = computeFootBilling([coveredConsultItem()], 'general', {
      hiraUnitValue: CLINIC_UNIT,
    });
    expect(withRate.copaymentTotal).toBe(4100);
    expect(without.copaymentTotal).toBe(4100);
  });
});

// ── 배선/불변식 가드 (라이브 배선 경로 + db_change 0) ────────────────────────────
test.describe('배선 가드', () => {
  test('footBilling: loadEffectiveInsuranceGradeEx 가 infantCopayRate 동반 반환 + 나이파생 세부율 배선', () => {
    const src = read(FOOTBILLING);
    expect(src).toMatch(/loadEffectiveInsuranceGradeEx/);
    expect(src).toMatch(/infantCopayRate/);
    // 나이 파생 infant 만 세부율 부여 (elderly_flat 은 4구간 → null)
    expect(src).toMatch(/ag\.grade === 'infant' \? ag\.rate : null/);
    // effectiveCopayRate 단일 헬퍼 소비 (병렬 재계산 경로 신설 아님)
    expect(src).toMatch(/effectiveCopayRate\(insuranceGrade/);
  });

  test('PaymentMiniWindow: ageInfantRate 를 빌링 grain 전반에 배선', () => {
    const src = read(PMW);
    expect(src).toMatch(/loadEffectiveInsuranceGradeEx/);
    expect(src).toMatch(/customerInfantCopayRate/);
    expect(src).toMatch(/ageInfantRate:\s*customerInfantCopayRate/);
  });

  test('db_change 0 — 본 티켓 신규 마이그레이션 파일 없음 (FE rate 배선 전용, RPC 미접촉)', () => {
    const migDir = path.join(ROOT, 'supabase/migrations');
    const files = fs.existsSync(migDir) ? fs.readdirSync(migDir) : [];
    expect(
      files.some((f) => /COPAY-INFANT|copay_infant|infant_5pct/i.test(f)),
    ).toBe(false);
  });
});
