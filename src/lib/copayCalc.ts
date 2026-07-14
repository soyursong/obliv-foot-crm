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
  /**
   * 점수당 원(환산지수, 원). governed data — 하드코딩 fallback 없음.
   * NULL = 데이터 불완전 → data_incomplete=true BLOCK (임의 상수 계산강행 금지).
   * (T-20260713-foot-HIRA-UNIT-VALUE-2026-UPDATE)
   */
  hira_unit_value: number | null;
}

export interface CopayCalcResult {
  base_amount: number;
  insurance_covered_amount: number;
  copayment_amount: number;
  exempt_amount: number;
  applied_rate: number;
  applied_grade: InsuranceGrade;
  /**
   * 데이터 불완전 BLOCK 플래그 (서버 RPC data_incomplete 미러).
   * true = 산출 불가(급여+hira_score NULL default-deny / hira_unit_value NULL).
   * 금액 날조 금지 → 모든 금액 0, applied_rate 0. (§2-2-1b)
   */
  data_incomplete: boolean;
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

/** data_incomplete BLOCK 결과 (금액 날조 금지 — 모두 0, rate 0). */
function blockedResult(grade: InsuranceGrade): CopayCalcResult {
  return {
    base_amount: 0,
    insurance_covered_amount: 0,
    copayment_amount: 0,
    exempt_amount: 0,
    applied_rate: 0,
    applied_grade: grade,
    data_incomplete: true,
  };
}

/**
 * 건보 본인부담 산출 (순수 함수) — 서버 RPC calc_copayment v1.3 미러.
 *
 * 산출 규칙 (서버 RPC calc_copayment와 동일):
 *  1. 비급여 or 외국인 → 전액 본인부담 (price 기준)
 *  2. 급여 + hira_score NULL → default-deny (general 만 전액본인부담 fallback, 그 외 BLOCK) [NULLFIX v1.2]
 *  3. 점당단가(hira_unit_value) NULL → data_incomplete BLOCK (89.4 fallback 제거) [이슈1]
 *  4. copayment_rate_override 있으면 우선 적용
 *  5. 의료급여 1종 → MIN(1,000, 수가)
 *  6. 65세(elderly_flat) 정률제 4구간 [이슈2, §2-2-3]:
 *       ≤15,000=정액 1,500 / ~20,000=10% / ~25,000=20% / >25,000=30%
 *       정률구간 원단위 = 100원 미만 절사(FLOOR) [ROUNDING-CONFIRM, 시행령 별표2 §19①]
 *  7. 그 외 → CEIL(base × rate / 100) × 100 (100원 절상)
 */
export function calcCopayment(
  service: CopayCalcServiceInput,
  clinic: CopayCalcClinicInput,
  grade: InsuranceGrade,
): CopayCalcResult {
  const isCovered = !!service.is_insurance_covered;

  // ── 1. 비급여 / 외국인 → 전액 본인부담 ────────────────
  if (!isCovered || grade === 'foreigner') {
    const base = service.price ?? 0;
    return {
      base_amount: base,
      insurance_covered_amount: 0,
      copayment_amount: base,
      exempt_amount: 0,
      applied_rate: 1.0,
      applied_grade: grade,
      data_incomplete: false,
    };
  }

  // ── 2. 급여 + hira_score NULL → default-deny (NULLFIX v1.2) ─────────────
  if (service.hira_score == null) {
    if (grade === 'general') {
      const base = service.price ?? 0;
      return {
        base_amount: base,
        insurance_covered_amount: 0,
        copayment_amount: base,
        exempt_amount: 0,
        applied_rate: 1.0,
        applied_grade: grade,
        data_incomplete: false,
      };
    }
    // low_income_1/2·infant·medical_aid·elderly·unverified 등 → BLOCK
    return blockedResult(grade);
  }

  // ── 3. 점당단가 governed: NULL → BLOCK (89.4 fallback 제거) [이슈1] ──────
  if (clinic.hira_unit_value == null) {
    return blockedResult(grade);
  }

  // ── 4. 수가 산출 ──────────────────────────────────────
  const baseRate = getBaseCopayRate(grade);
  // OVERRIDE-RULE: O-001 — 서비스별 실손보험 자기부담률 개별 적용
  // OVERRIDE: copayCalc — copayment_rate_override 서비스별 자기부담률 추가 적용. 기본 로직 전체 연동.
  const hasOverride = service.copayment_rate_override != null;
  const rate = service.copayment_rate_override ?? baseRate;
  const base = Math.round(service.hira_score * clinic.hira_unit_value);

  // ── 5·6·7. 정액/정률 분기 ─────────────────────────────
  let copay: number;
  if (grade === 'medical_aid_1') {
    copay = Math.min(1000, base);
  } else if (grade === 'elderly_flat' && !hasOverride) {
    // [이슈2] 노인 외래 정률제 4구간 (의원급, §2-2-3). override 있으면 정률경로(else)로 흡수.
    // [ROUNDING-CONFIRM] 정률구간 원단위 = 100원 미만 절사(버림, FLOOR). 규정 근거:
    //   국민건강보험법 시행령 별표2 제19조 제1항 "100원 미만은 제외한다"
    //   + 심평원 외래 본인부담기준표 "100원미만 절사" (전 구분 동일).
    //   종전 CEIL(100원 올림)로 정률구간 초과징수 관찰 → FLOOR 정정.
    //   (T-20260714-foot-HIRA-ELDERLY-ROUNDING-CONFIRM)
    if (base <= 15000) {
      copay = Math.min(1500, base);          // 정액 1,500 (절사 무영향)
    } else if (base <= 20000) {
      copay = Math.floor((base * 0.10) / 100) * 100;  // 10% · 100원 미만 절사
    } else if (base <= 25000) {
      copay = Math.floor((base * 0.20) / 100) * 100;  // 20% · 100원 미만 절사
    } else {
      copay = Math.floor((base * 0.30) / 100) * 100;  // 30% · 100원 미만 절사
    }
    if (copay > base) copay = base;
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
    data_incomplete: false,
  };
}
