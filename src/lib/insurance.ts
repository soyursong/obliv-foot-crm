/**
 * 건보 본인부담 — 타입 + 라벨 SSOT
 *
 * T-20260504-foot-INSURANCE-COPAYMENT
 * T-20260520-foot-INS-UI  (AC-1: 순수 산출 함수를 copayCalc.ts 로 분리)
 *
 * 산출 순수 함수는 copayCalc.ts 로 이전. 이 파일은 타입·라벨 SSOT.
 * RPC `calc_copayment` 가 진실의 원천 — 클라이언트는 미리보기/테스트용.
 */

// ── copayCalc.ts 재수출 (하위 호환) ─────────────────────────────────────────
// 기존 import { calcCopaymentLocal, ServiceLike, ClinicLike, CopaymentResult }
// from '@/lib/insurance' 패턴이 그대로 동작하도록 재수출.
export type {
  CopayCalcResult      as CopaymentResult,
  CopayCalcServiceInput as ServiceLike,
  CopayCalcClinicInput  as ClinicLike,
} from './copayCalc';
export { getBaseCopayRate, calcCopayment as calcCopaymentLocal } from './copayCalc';

// ── 자격등급 타입 ───────────────────────────────────────────────────────────

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

// ── 라벨 ────────────────────────────────────────────────────────────────────

export const INSURANCE_GRADE_LABELS: Record<InsuranceGrade, string> = {
  general:       '일반 (30%)',
  low_income_1:  '차상위 1종 (14%)',
  low_income_2:  '차상위 2종 (14%)',
  medical_aid_1: '의료급여 1종 (정액 1,000원)',
  medical_aid_2: '의료급여 2종 (15%)',
  infant:        '만6세 미만 (21%)',
  elderly_flat:  '만65세 정액 (1,500원)',
  foreigner:     '외국인 (비급여)',
  unverified:    '미확인',
};

export const INSURANCE_GRADE_SHORT_LABELS: Record<InsuranceGrade, string> = {
  general:       '일반',
  low_income_1:  '차상위1',
  low_income_2:  '차상위2',
  medical_aid_1: '의료급여1',
  medical_aid_2: '의료급여2',
  infant:        '6세미만',
  elderly_flat:  '65세정액',
  foreigner:     '외국인',
  unverified:    '미확인',
};

export const INSURANCE_GRADE_SOURCE_LABELS: Record<InsuranceGradeSource, string> = {
  jeoneung_crm:     '전능CRM',
  eligibility_cert: '자격득실확인서',
  hira_lookup:      '요양기관정보마당',
  manual_input:     '수동 입력',
};

export const HIRA_CATEGORY_LABELS: Record<HiraCategory, string> = {
  consultation: '진찰료',
  examination:  '검사료',
  prescription: '처방료',
  procedure:    '처치료',
  medication:   '약가',
  document:     '서류',
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

// ── 검증일 유틸 ─────────────────────────────────────────────────────────────

/** 등급 검증일 경과 일수. 90일 이상이면 갱신 권장. */
export function daysSinceVerified(verifiedAt: string | null | undefined): number | null {
  if (!verifiedAt) return null;
  const ms = Date.now() - new Date(verifiedAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export const VERIFICATION_STALE_DAYS = 90;
