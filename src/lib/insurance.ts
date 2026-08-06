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
export { getBaseCopayRate, copayFromBase, copayBasisText, calcCopayment as calcCopaymentLocal } from './copayCalc';

// ── 자격등급 타입 ───────────────────────────────────────────────────────────

// ── 자격등급 축 vs 나이 파생 축 ────────────────────────────────────────────────
// T-20260720-foot-COPAY-AGE-DERIVED-AUTO (§2 핵심 설계 전환):
//   InsuranceGrade 는 두 개의 **직교 축**을 한 enum 에 담는다 —
//     (A) 자격등급 축(외부 조회 필요): general·low_income_*·medical_aid_*·foreigner·unverified.
//         공단 자격조회로만 확정되며, 라이브 고객 89%가 미설정(unverified/null).
//     (B) 나이 파생 축(외부 조회 불요): infant·elderly_flat.
//         **자격이 아니라 생년월일만으로 확정되는 속성**이다(만6세미만 / 만65세이상). 따라서 수기 등급입력에
//         묶어두지 않고 customers 생년월일(fn_customer_birthdates RPC)로 자동판정한다(customerAge.ts
//         deriveAgeCopayGrade). enum 값 자체는 유지(마이그 유발 방지) — 판정 소스만 '수기입력'→'나이 파생'.
//   ⚠ elderly_flat/infant 가 등급 컬럼(customers.insurance_grade)에 명시 저장돼 있으면 그 값을 존중하되,
//     미설정/unverified 인 89% 구간은 나이로 자동 채운다(loadEffectiveInsuranceGrade). 계산 산식은 불변.
export type InsuranceGrade =
  | 'general'          // [자격축] 일반 30%
  | 'low_income_1'     // [자격축] 차상위 1종 면제 (의원 외래 0원) — 종전 14% 오적용 정정(v1.6)
  | 'low_income_2'     // [자격축] 차상위 2종 정액 1,000원 (의원 외래) — 종전 14% 오적용 정정(v1.6)
  | 'medical_aid_1'    // [자격축] 의료급여 1종 정액 1,000원 (의원 외래)
  | 'medical_aid_2'    // [자격축] 의료급여 2종 정액 1,000원 (의원 외래) — 종전 15% 오적용 정정(v1.6)
  | 'infant'           // [나이 파생축] 만6세 미만 (생년월일 파생, 조회 불요). 1세미만 5%/6세미만 21%
  | 'elderly_flat'     // [나이 파생축] 만65세 이상 (생년월일 파생, 조회 불요). 외래 4구간 정률제
  | 'foreigner'        // [자격축] 외국인 (전액 비급여)
  | 'unverified';      // [자격축] 미확인 (미설정 89% — 나이 파생으로 노인/영유아만 자동 확정)

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
  low_income_1:  '차상위 1종 (면제)',
  low_income_2:  '차상위 2종 (정액 1,000원)',
  medical_aid_1: '의료급여 1종 (정액 1,000원)',
  medical_aid_2: '의료급여 2종 (정액 1,000원)',
  infant:        '만6세 미만 (21%)',
  elderly_flat:  '만65세 노인 (정률제)',
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
