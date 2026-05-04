/**
 * 건보 본인부담 — 타입 + 라벨 + 순수 계산 유틸
 *
 * T-20260504-foot-INSURANCE-COPAYMENT
 *
 * RPC `calc_copayment` 와 동일한 분기를 클라이언트에서 재현한다.
 * (서버 RPC가 진실의 원천 — 클라이언트는 미리보기/테스트용)
 */

export type InsuranceGrade =
  | 'general'          // 일반 30%
  | 'low_income_1'     // 차상위 1종 14%
  | 'low_income_2'     // 차상위 2종 14%
  | 'medical_aid_1'    // 의료급여 1종 0% (정액 1,000원)
  | 'medical_aid_2'    // 의료급여 2종 15%
  | 'infant'           // 만6세 미만 21%
  | 'elderly_flat'     // 만65세 정액 (조건부)
  | 'foreigner'        // 외국인 (전액 비급여)
  | 'unverified';      // 미확인

export type InsuranceGradeSource =
  | 'jeoneung_crm'
  | 'eligibility_cert'
  | 'hira_lookup'
  | 'manual_input';

export type HiraCategory =
  | 'consultation'
  | 'examination'
  | 'prescription'
  | 'procedure'
  | 'medication'
  | 'document';

export interface CopaymentResult {
  base_amount: number;
  insurance_covered_amount: number;
  copayment_amount: number;
  exempt_amount: number;
  applied_rate: number;
  applied_grade: InsuranceGrade;
}

export const INSURANCE_GRADE_LABELS: Record<InsuranceGrade, string> = {
  general: '일반 (30%)',
  low_income_1: '차상위 1종 (14%)',
  low_income_2: '차상위 2종 (14%)',
  medical_aid_1: '의료급여 1종 (정액 1,000원)',
  medical_aid_2: '의료급여 2종 (15%)',
  infant: '만6세 미만 (21%)',
  elderly_flat: '만65세 정액 (1,500원)',
  foreigner: '외국인 (비급여)',
  unverified: '미확인',
};

export const INSURANCE_GRADE_SHORT_LABELS: Record<InsuranceGrade, string> = {
  general: '일반',
  low_income_1: '차상위1',
  low_income_2: '차상위2',
  medical_aid_1: '의료급여1',
  medical_aid_2: '의료급여2',
  infant: '6세미만',
  elderly_flat: '65세정액',
  foreigner: '외국인',
  unverified: '미확인',
};

export const INSURANCE_GRADE_SOURCE_LABELS: Record<InsuranceGradeSource, string> = {
  jeoneung_crm: '전능CRM',
  eligibility_cert: '자격득실확인서',
  hira_lookup: '요양기관정보마당',
  manual_input: '수동 입력',
};

export const HIRA_CATEGORY_LABELS: Record<HiraCategory, string> = {
  consultation: '진찰료',
  examination: '검사료',
  prescription: '처방료',
  procedure: '처치료',
  medication: '약가',
  document: '서류',
};

export const ALL_INSURANCE_GRADES: InsuranceGrade[] = [
  'general',
  'low_income_1',
  'low_income_2',
  'medical_aid_1',
  'medical_aid_2',
  'infant',
  'elderly_flat',
  'foreigner',
  'unverified',
];

export const ALL_INSURANCE_GRADE_SOURCES: InsuranceGradeSource[] = [
  'jeoneung_crm',
  'eligibility_cert',
  'hira_lookup',
  'manual_input',
];

/** 등급별 기본 본인부담률 (override 미적용 시) */
export function getBaseCopayRate(grade: InsuranceGrade): number {
  switch (grade) {
    case 'general':
      return 0.3;
    case 'low_income_1':
    case 'low_income_2':
      return 0.14;
    case 'medical_aid_1':
      return 0;
    case 'medical_aid_2':
      return 0.15;
    case 'infant':
      return 0.21;
    case 'elderly_flat':
      return 0.3;
    case 'foreigner':
      return 1.0;
    case 'unverified':
    default:
      return 0.3;
  }
}

export interface ServiceLike {
  is_insurance_covered: boolean | null;
  hira_score: number | null;
  copayment_rate_override: number | null;
  price: number;
}

export interface ClinicLike {
  hira_unit_value: number | null;
}

/**
 * 클라이언트 사이드 본인부담 산출 (서버 RPC와 동일 로직).
 *
 * 입력:
 *  - service: hira_score / is_insurance_covered / copayment_rate_override / price
 *  - clinic.hira_unit_value (점수당 원, 기본 89.4)
 *  - grade: 환자 등급
 *
 * 산출 규칙:
 *  - 비급여 또는 외국인 → 전액 본인부담
 *  - hira_score 미설정 → 비급여 폴백
 *  - 의료급여 1종 → 정액 1,000원 (수가 미만일 때만)
 *  - 65세 정액 + 수가 ≤ 15,000 → 1,500원
 *  - 그 외 → CEIL(base * rate / 100) * 100 (100원 절상)
 */
export function calcCopaymentLocal(
  service: ServiceLike,
  clinic: ClinicLike,
  grade: InsuranceGrade,
): CopaymentResult {
  const isCovered = !!service.is_insurance_covered;

  // 비급여 또는 외국인 → 전액 본인부담
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

  // hira_score 미설정 → 비급여 폴백
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

  const baseRate = getBaseCopayRate(grade);
  const rate = service.copayment_rate_override ?? baseRate;
  const unitValue = clinic.hira_unit_value ?? 89.4;
  const base = Math.round(service.hira_score * unitValue);

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

/** 등급 검증일 경과 일수. 90일 이상이면 갱신 권장. */
export function daysSinceVerified(verifiedAt: string | null | undefined): number | null {
  if (!verifiedAt) return null;
  const ms = Date.now() - new Date(verifiedAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export const VERIFICATION_STALE_DAYS = 90;
