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
    // ★[v1.6 GRADE-BRANCH — T-20260720-foot-COPAY-GRADE-BRANCH-MISSING] 차상위·의급 정액/면제.
    //   현행 14%/15% 정률은 "입원·병원급 요율을 의원급 외래에 오적용"한 것(DA 재확정 GO,
    //   da_ratify_copayment_grade_rates_20260720). foot=의원급 1차 외래 → 정액/면제가 정본.
    //   근거: 의료급여법 시행령 별표1(의급 1·2종 의원외래 1,000) / 국민건강보험법 시행령 별표2 3호 라목(차상위).
    //   ▷ 이 rate 는 정보성(applied_rate)일 뿐, 실 copay 는 copayFromBase 의 면제·정액 분기가 정본.
    //     정액/면제 등급은 medical_aid_1(0.00) 관행과 통일(DA §applied_rate sub-note, non-blocking).
    //   ⚠ SCOPE: 의원급(1차) 외래 전용. 병원급·입원은 14%/15%/10% 정률 정본 — 타 CRM 재사용 금지.
    case 'low_income_1':  return 0.00; // 면제 (차상위 희귀·중증난치·중증) → copay 0원
    case 'low_income_2':  return 0.00; // 정액 1,000원 (차상위 만성·18세미만) — 종전 0.14 오적용
    case 'medical_aid_1': return 0.00; // 정액 1,000원 (의료급여 1종) — 유지
    case 'medical_aid_2': return 0.00; // 정액 1,000원 (의료급여 2종) — 종전 0.15 오적용
    case 'infant':        return 0.21;
    case 'elderly_flat':  return 0.30; // 정액제 분기는 calcCopayment 내에서 처리
    case 'foreigner':     return 1.00;
    case 'unverified':
    default:              return 0.30;
  }
}

/**
 * 등급별 본인부담 '기준' 라벨 텍스트 (화면·서류 공유 SSOT).
 *
 * 정액/면제/노인 정률제 등급은 단일 % 로 표현할 수 없다(정액=금액, 면제=0원,
 * elderly=4구간 정률제). getBaseCopayRate 를 직접 `%` 로 찍으면 v1.6 에서 정액/면제
 * 등급이 "0%", elderly 가 "30%" 로 **오표기**되므로(§3-6), 라벨 표시부는 이 기준명을 쓴다.
 * 정률(general/infant) 및 등급미상(unverified·급여 방문)은 null → 호출부가 "N%" 를 표시.
 *
 * (T-20260720-foot-COPAY-GRADE-BRANCH-MISSING §3-6 — getBaseCopayRate 직접 %표기의
 *  elderly '30%' 오표기 + v1.6 정액/면제 '0%' 오표기 정정. 값 산정과 무관·표시 전용.)
 */
export function copayBasisText(grade: InsuranceGrade): string | null {
  switch (grade) {
    case 'low_income_1':  return '면제';       // 차상위 희귀·중증난치·중증 → 0원
    case 'medical_aid_1':
    case 'medical_aid_2':
    case 'low_income_2':  return '정액';       // 의급 1·2종 / 차상위 만성·18세미만 → 정액 1,000원
    case 'elderly_flat':  return '정률제';     // 노인 외래 4구간(정액1,500 / 10 / 20 / 30%)
    case 'foreigner':     return '전액';       // 100% 본인부담
    default:              return null;         // general/infant/unverified → 호출부가 % 표기
  }
}

// ──────────────────────────────────────────────────────────
// 등급→copay 단일 SSOT 헬퍼 (병렬 재계산 경로 신설 금지, DA §제약1)
// ──────────────────────────────────────────────────────────

/**
 * 등급 + base(급여 수가 또는 급여 진료비 합) → 본인부담금(copay).
 *
 * calcCopayment(RPC calc_copayment v1.6 미러)와 footBilling 3계산기(computeFootBilling /
 * fillBillItemCopayment / 문서출력)가 **공유하는 유일한 등급→copay 규칙**이다. 등급 분기는
 * 오직 이 한 곳에서만 정의한다 — 병렬 재계산 경로 신설 금지(DA §제약1: SSOT 단일소비).
 *
 * 분기 (의원급 1차 외래 scope):
 *  · low_income_1                          → 0원 (면제; 시행령 별표2 3호 라목)
 *  · medical_aid_1/2 · low_income_2        → LEAST(1,000, base) 정액 (의료급여법 별표1 / 시행령 별표2)
 *  · elderly_flat (override 없음)          → 노인 외래 4구간(≤15,000 정액1,500 / ~20,000 10% / ~25,000 20% / >25,000 30%)
 *  · general/infant/unverified/ELSE        → FLOOR(base × rate / 100) × 100 (100원 미만 절사)
 *  정률경로·노인 정률구간 = 100원 미만 절사(FLOOR). CIT-2026-001/002 + revenue_insurance_split §2-2 v1.12.
 *
 * @param grade       건보 등급
 * @param base        급여 base (RPC=ROUND(hira_score×hira_unit_value), footBilling=급여 진료비 합)
 * @param rate        적용 정률(0~1). override 있으면 override, 없으면 getBaseCopayRate(grade). 정률경로에만 사용.
 * @param hasOverride copayment_rate_override 존재 여부 — elderly 4구간 흡수(→정률경로) 판정에만 사용.
 */
export function copayFromBase(
  grade: InsuranceGrade,
  base: number,
  rate: number,
  hasOverride: boolean,
): number {
  if (base <= 0) return 0;

  // 면제 — 차상위 희귀·중증난치·중증 (시행령 별표2 3호 라목). 본인부담 0원.
  if (grade === 'low_income_1') return 0;

  // 정액 1,000원 (직접조제 1,500 edge 미대상) — 의급 1·2종 / 차상위 만성·18세미만 의원 외래.
  if (grade === 'medical_aid_1' || grade === 'low_income_2' || grade === 'medical_aid_2') {
    return Math.min(1000, base);
  }

  // 노인 외래 정률제 4구간 (65세+, 의원급). override 있으면 정률경로(아래)로 흡수(개별 실손 자기부담률 우선).
  //   ★[ROUNDING] 정률구간 100원 미만 절사(FLOOR). 시행령 별표2 §19① / 심평원 외래기준. (T-20260714)
  if (grade === 'elderly_flat' && !hasOverride) {
    let copay: number;
    if (base <= 15000) {
      copay = Math.min(1500, base);                     // 정액 1,500 (절사 무영향)
    } else if (base <= 20000) {
      copay = Math.floor((base * 0.10) / 100) * 100;    // 10% · 100원 미만 절사
    } else if (base <= 25000) {
      copay = Math.floor((base * 0.20) / 100) * 100;    // 20% · 100원 미만 절사
    } else {
      copay = Math.floor((base * 0.30) / 100) * 100;    // 30% · 100원 미만 절사
    }
    return Math.min(copay, base);
  }

  // 일반 정률경로 (general/infant/unverified/ELSE) — 100원 미만 절사(FLOOR, v1.5 정정 유지).
  return Math.min(Math.floor((base * rate) / 100) * 100, base);
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
 * 건보 본인부담 산출 (순수 함수) — 서버 RPC calc_copayment v1.6 미러.
 *
 * 산출 규칙 (서버 RPC calc_copayment와 동일):
 *  1. 비급여 or 외국인 → 전액 본인부담 (price 기준)
 *  2. 급여 + hira_score NULL → default-deny (general 만 전액본인부담 fallback, 그 외 BLOCK) [NULLFIX v1.2]
 *  3. 점당단가(hira_unit_value) NULL → data_incomplete BLOCK (89.4 fallback 제거) [이슈1]
 *  4. copayment_rate_override 있으면 우선 적용(정률경로·elderly 흡수에만)
 *  5. 등급→copay = copayFromBase 단일 SSOT 헬퍼 (병렬 재계산 경로 신설 금지):
 *       · low_income_1 → 0원(면제) [v1.6 신설 · 시행령 별표2 3호 라목]
 *       · medical_aid_1/2 · low_income_2 → MIN(1,000, 수가) 정액 [v1.6: 의급2·차상위2 정률→정액 정정]
 *       · elderly_flat(override 없음) → 노인 외래 4구간(≤15,000 정액1,500 / 10% / 20% / 30%, FLOOR)
 *       · general/infant/unverified/ELSE → FLOOR(base × rate / 100) × 100 (100원 미만 절사, v1.5)
 *         [CIT-2026-001/002 외래 본인부담 전반 FLOOR. 종전 CEIL 초과징수 정정]
 *  ⚠ 정액/면제 값 = 의원급(1차) 외래 전용. 병원급·입원 재사용 금지(cross-CRM SCOPE CAVEAT).
 *  (T-20260720-foot-COPAY-GRADE-BRANCH-MISSING — DA 재확정 GO, da_ratify_copayment_grade_rates_20260720)
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

  // ── 5·6·7. 정액/면제/정률 분기 — 단일 SSOT 헬퍼(copayFromBase) 소비. ──────────
  //   등급→copay 규칙은 copayFromBase 한 곳에만 존재(RPC calc_copayment v1.6 · footBilling 3계산기 공유).
  //   병렬 재계산 경로 신설 금지(DA §제약1). v1.6 델타: low_income_1 면제(0) / low_income_2·medical_aid_2 정액.
  const copay = copayFromBase(grade, base, rate, hasOverride);

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
