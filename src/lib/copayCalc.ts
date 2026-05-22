/**
 * copayCalc.ts — 공통 건보 본인부담 산출 순수 함수
 *
 * T-20260520-ins-COPAY-CALC (공통 라이브러리 추출)
 * T-20260520-foot-INS-UI   (풋센터 통합 - AC-1)
 *
 * 서버 RPC calc_copayment와 동일 로직.
 * 클라이언트 미리보기 + 단위테스트용.
 * 순수 함수 — 외부 의존 없음, import type만 허용.
 */

import type { InsuranceGrade } from './insurance';

// ──────────────────────────────────────────────────────────
// Input / Output 타입
// ──────────────────────────────────────────────────────────

export interface CopayCalcServiceInput {
  /** 급여 여부 */
  is_insurance_covered: boolean | null;
  /** HIRA 점수 (수가 = score × hira_unit_value) */
  hira_score: number | null;
  /** 서비스별 본인부담률 오버라이드 (NULL = 등급별 기본값) */
  copayment_rate_override: number | null;
  /** 비급여 폴백용 정가 */
  price: number;
}

export interface CopayCalcClinicInput {
  /** 점수당 원 (기본 89.4 — 2024 기준) */
  hira_unit_value: number | null;
}

export interface CopayCalcResult {
  base_amount: number;
  insurance_covered_amount: number;
  copayment_amount: number;
  exempt_amount: number;
  applied_rate: number;
  applied_grade: InsuranceGrade;
}

// ──────────────────────────────────────────────────────────
// 등급별 기본 본인부담률
// ──────────────────────────────────────────────────────────

/**
 * 등급별 기본 본인부담률 반환.
 * RPC calc_copayment 의 v_rate CASE 분기와 동일.
 */
export function getBaseCopayRate(grade: InsuranceGrade): number {
  switch (grade) {
    case 'general':       return 0.30;
    case 'low_income_1':
    case 'low_income_2':  return 0.14;
    case 'medical_aid_1': return 0.00;
    case 'medical_aid_2': return 0.15;
    case 'infant':        return 0.21;
    case 'elderly_flat':  return 0.30; // 정액제 분기는 calcCopayment 내에서 처리
    case 'foreigner':     return 1.00;
    case 'unverified':
    default:              return 0.30;
  }
}

// ──────────────────────────────────────────────────────────
// 핵심 산출 함수
// ──────────────────────────────────────────────────────────

/**
 * 건보 본인부담 산출 (순수 함수).
 *
 * 산출 규칙 (서버 RPC calc_copayment와 동일):
 *  1. 비급여 or 외국인 → 전액 본인부담 (price 기준)
 *  2. hira_score 미설정 → 비급여 폴백
 *  3. copayment_rate_override 있으면 우선 적용
 *  4. 의료급여 1종 → MIN(1,000, 수가)
 *  5. 65세 정액 + 수가 ≤ 15,000 → MIN(1,500, 수가)
 *  6. 그 외 → CEIL(base × rate / 100) × 100 (100원 절상)
 */
export function calcCopayment(
  service: CopayCalcServiceInput,
  clinic: CopayCalcClinicInput,
  grade: InsuranceGrade,
): CopayCalcResult {
  const isCovered = !!service.is_insurance_covered;

  // ── 1. 비급여 / 외국인 ────────────────────────────────
  if (!isCovered || grade === 'foreigner') {
    const base = service.price ?? 0;
    return {
      base_amount: base,
      insurance_covered_amount: 0,
      copayment_amount: base,
      exempt_amount: 0,
      applied_rate: 1.0,
      applied_grade: grade,
    };
  }

  // ── 2. hira_score 미설정 → 비급여 폴백 ───────────────
  if (service.hira_score == null) {
    const base = service.price ?? 0;
    return {
      base_amount: base,
      insurance_covered_amount: 0,
      copayment_amount: base,
      exempt_amount: 0,
      applied_rate: 1.0,
      applied_grade: grade,
    };
  }

  // ── 3. 수가 산출 ──────────────────────────────────────
  const baseRate = getBaseCopayRate(grade);
  // OVERRIDE-RULE: O-001 — 서비스별 실손보험 자기부담률 개별 적용
  // OVERRIDE: copayCalc — copayment_rate_override 서비스별 자기부담률 추가 적용. 기본 로직 전체 연동.
  const rate = service.copayment_rate_override ?? baseRate;
  const unitValue = clinic.hira_unit_value ?? 89.4;
  const base = Math.round(service.hira_score * unitValue);

  // ── 4 & 5. 정액제 분기 ────────────────────────────────
  let copay: number;
  if (grade === 'medical_aid_1') {
    copay = Math.min(1000, base);
  } else if (grade === 'elderly_flat' && base <= 15000) {
    copay = Math.min(1500, base);
  } else {
    // 100원 단위 절상
    copay = Math.ceil((base * rate) / 100) * 100;
    if (copay > base) copay = base;
  }

  const covered = Math.max(0, base - copay);
  return {
    base_amount: base,
    insurance_covered_amount: covered,
    copayment_amount: copay,
    exempt_amount: 0,
    applied_rate: rate,
    applied_grade: grade,
  };
}
