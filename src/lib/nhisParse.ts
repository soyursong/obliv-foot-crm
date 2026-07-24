/**
 * nhisParse — 건보공단 요양기관정보마당 수진자자격조회 결과 붙여넣기 파서 (순수 함수)
 *
 * T-20260724-foot-NHIS-MANUAL-CAPTURE (Phase 1)
 *   공단 API 자동조회 blocked → 직원이 포털에서 수기 조회 → 결과 복사 → 2번차트 붙여넣기.
 *   이 모듈은 붙여넣은 평문에서 (수진자성명·자격여부·증번호·자격취득일)을 라인스캔+라벨뒤값으로
 *   추출하고, 자격여부 → 화이트리스트 등급을 후보 매핑한다. **자동 확정 금지** — 사람이 최종 확정.
 *
 * 하드가드 (codex §15 — 위반 = P0 오청구):
 *   #1 화이트리스트 등급만 후보 제시. 특례/보훈/경감/무자격/외국인 = 후보 null + 경고(수기 유도).
 *      DA 정정(2026-07-24): write target = foreigner 제외 8값(가입외국인→general 은 age 등 별도판단,
 *      파서는 general 후보로 두되 나이가드가 걸림). foreigner 등급 자체는 write 금지 → 후보로 만들지 않음.
 *   #2 나이↔등급 clobber 금지: general 후보인데 생년월일이 6세미만(infant)/65세이상(elderly)이면
 *      general 로 덮어써 연령파생 등급이 소실될 위험 → 후보를 null 로 낮추고 경고(연령축은 별도확정).
 *   #4 수진자성명 ↔ CRM 환자명 대조: 불일치 시 강경고("다른 환자 결과").
 *
 * RRN·인증서는 붙여넣기 텍스트에 포함되지 않음(포털이 마스킹) — 본 파서는 평문 메타만 다룬다.
 */

import type { InsuranceGrade } from '@/lib/insurance';

/** 파서가 후보로 제시 가능한 등급 (화이트리스트, 자격축). 연령축(infant/elderly)·foreigner 제외 */
export type NhisCandidateGrade = Extract<
  InsuranceGrade,
  'general' | 'low_income_1' | 'low_income_2' | 'medical_aid_1' | 'medical_aid_2'
>;

export interface NhisParsedFields {
  /** 수진자성명 (신원 대조축) */
  patientName: string | null;
  /** 자격여부 원문 (예: "건강보험 직장", "의료급여 1종") */
  eligibilityRaw: string | null;
  /** 증번호 (cert_no scaffold 채움) */
  certNo: string | null;
  /** 자격취득일 (참고, YYYY-MM-DD 또는 원문) */
  acquiredDate: string | null;
  /** 자격여부 → 매핑된 화이트리스트 후보 등급. 매핑 불가/비화이트리스트 시 null */
  candidateGrade: NhisCandidateGrade | null;
  /**
   * 포털이 명시한 등급 라벨(사람이 볼 수 있는 원문 해석). candidateGrade 가 null 이어도 무엇으로
   * 읽혔는지 에코하기 위함. 비화이트리스트(특례/보훈 등)면 그 사유 텍스트.
   */
  gradeLabelRaw: string | null;
  /** candidateGrade 가 null 인 이유가 '비화이트리스트'인지(경고 문구 분기용) */
  nonWhitelist: boolean;
}

export type NhisWarningLevel = 'warn' | 'strong';

export interface NhisParseWarning {
  code:
    | 'non_whitelist'      // 화이트리스트 외 등급 (특례/보훈/경감/무자격/외국인)
    | 'name_mismatch'      // 수진자성명 ≠ 환자명 (오조회 최상위 위험)
    | 'age_grade_conflict' // 나이↔등급 모순 (general 인데 infant/elderly)
    | 'name_missing'       // 성명 추출 실패
    | 'grade_unresolved';  // 자격여부 추출/매핑 실패
  level: NhisWarningLevel;
  message: string;
}

export interface NhisParsedResult extends NhisParsedFields {
  /** 붙여넣은 평문 전체 (평문 에코용) */
  rawText: string;
  /** 가드 평가 경고 목록 */
  warnings: NhisParseWarning[];
  /**
   * InsuranceGradeSelect 에 넘길 최종 제안 등급.
   * candidateGrade 가 있고 age/whitelist 가드에 걸리지 않을 때만 non-null.
   * null 이면 자동 제안 없음 → 사람이 직접 선택(자동확정 금지 불변식 유지).
   */
  suggestedGrade: NhisCandidateGrade | null;
  /** 제안 변경 감지 키(같은 텍스트 재붙여넣기 시에도 edit 재진입 트리거) */
  stamp: number;
}

// ── 라벨 사전 ────────────────────────────────────────────────────────────────
// 포털 출력은 라벨:값 형태. 라벨 변형(공백/괄호/콜론)을 흡수하기 위해 정규식으로 라인 스캔.

const NAME_LABELS = ['수진자성명', '수진자 성명', '성명', '가입자성명', '가입자 성명'];
const ELIG_LABELS = ['자격여부', '자격 여부', '건강보험자격', '보험자격', '자격구분', '가입자구분', '자격'];
const CERT_LABELS = ['증번호', '증 번호', '증번호(세대주)', '건강보험증번호', '보험증번호'];
const ACQUIRE_LABELS = ['자격취득일', '자격 취득일', '취득일', '적용일자', '적용일'];

/** 라벨 목록 중 하나로 시작하는 라인에서 라벨 뒤 값을 추출. 값이 다음 라인에 있는 경우도 폴백. */
function extractByLabels(lines: string[], labels: string[]): string | null {
  // 긴 라벨 우선(부분일치 오탐 방지: '수진자성명' 이 '성명' 보다 먼저)
  const sorted = [...labels].sort((a, b) => b.length - a.length);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    for (const label of sorted) {
      // 라벨 뒤에 구분자(:, 공백, 탭)와 값
      const re = new RegExp(`^${escapeRe(label)}\\s*[:：]?\\s*(.+)$`);
      const m = line.match(re);
      if (m && m[1].trim()) {
        return m[1].trim();
      }
      // 라벨만 있고 값이 다음 라인
      if (line.replace(/[:：]\s*$/, '').trim() === label && i + 1 < lines.length) {
        const next = lines[i + 1].trim();
        if (next) return next;
      }
    }
  }
  return null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 자격여부 원문 → 화이트리스트 후보 등급 + 라벨/비화이트리스트 플래그 */
function mapEligibility(raw: string | null): {
  candidate: NhisCandidateGrade | null;
  label: string | null;
  nonWhitelist: boolean;
} {
  if (!raw) return { candidate: null, label: null, nonWhitelist: false };
  const t = raw.replace(/\s+/g, '');

  // 비화이트리스트 사유 우선 검출 (자동저장 절대 금지)
  const nonWL: Array<[RegExp, string]> = [
    [/산정특례|특례/, '산정특례'],
    [/보훈/, '보훈'],
    [/경감/, '경감대상'],
    [/무자격|자격없음|자격상실/, '무자격/자격상실'],
    [/외국인|재외국민/, '외국인'],
  ];
  for (const [re, label] of nonWL) {
    if (re.test(t)) return { candidate: null, label, nonWhitelist: true };
  }

  // 의료급여
  if (/의료급여1종|의료급여\(?1/.test(t)) return { candidate: 'medical_aid_1', label: '의료급여 1종', nonWhitelist: false };
  if (/의료급여2종|의료급여\(?2/.test(t)) return { candidate: 'medical_aid_2', label: '의료급여 2종', nonWhitelist: false };
  if (/의료급여/.test(t)) return { candidate: null, label: '의료급여(종 미상)', nonWhitelist: false };

  // 차상위
  if (/차상위1종|희귀난치|차상위\(?1/.test(t)) return { candidate: 'low_income_1', label: '차상위 1종', nonWhitelist: false };
  if (/차상위2종|만성질환|차상위\(?2/.test(t)) return { candidate: 'low_income_2', label: '차상위 2종', nonWhitelist: false };
  if (/차상위/.test(t)) return { candidate: null, label: '차상위(종 미상)', nonWhitelist: false };

  // 건강보험 (일반) — 직장/지역 가입자
  if (/건강보험|직장가입자|지역가입자|건강보험자격있음|자격있음/.test(t)) {
    return { candidate: 'general', label: '건강보험 (일반)', nonWhitelist: false };
  }

  return { candidate: null, label: raw.trim() || null, nonWhitelist: false };
}

/** 붙여넣은 평문 → 필드 추출 (순수, 고객 컨텍스트 불필요) */
export function parseNhisEligibilityText(rawText: string): NhisParsedFields {
  const lines = rawText.split(/\r?\n/).map((l) => l.replace(/\t/g, ' '));
  const patientName = extractByLabels(lines, NAME_LABELS);
  const eligibilityRaw = extractByLabels(lines, ELIG_LABELS);
  const certNoRaw = extractByLabels(lines, CERT_LABELS);
  const acquiredDate = extractByLabels(lines, ACQUIRE_LABELS);

  const { candidate, label, nonWhitelist } = mapEligibility(eligibilityRaw);

  return {
    patientName: patientName || null,
    eligibilityRaw: eligibilityRaw || null,
    // 증번호는 숫자/하이픈만 남김(주변 텍스트 방어). 비면 null.
    certNo: certNoRaw ? (certNoRaw.replace(/[^0-9-]/g, '') || null) : null,
    acquiredDate: acquiredDate || null,
    candidateGrade: candidate,
    gradeLabelRaw: label,
    nonWhitelist,
  };
}

// ── 나이 파생 (하드가드 #2) ──────────────────────────────────────────────────
// birthDateDisplay = fn_customer_birthdates RPC 산출 YYYY-MM-DD (생년월일 SSOT). null 이면 age 가드 skip.

/** YYYY-MM-DD 문자열 → 만나이. asOfMs 는 기준 시각(테스트 주입 가능, 기본 Date.now). */
export function ageFromBirthDate(birthDateDisplay: string | null | undefined, asOfMs?: number): number | null {
  if (!birthDateDisplay) return null;
  const m = birthDateDisplay.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const by = Number(m[1]);
  const bm = Number(m[2]);
  const bd = Number(m[3]);
  const now = new Date(asOfMs ?? Date.now());
  let age = now.getFullYear() - by;
  const mo = now.getMonth() + 1 - bm;
  if (mo < 0 || (mo === 0 && now.getDate() < bd)) age -= 1;
  if (Number.isNaN(age) || age < 0 || age > 150) return null;
  return age;
}

export interface NhisGuardContext {
  /** 현재 차트 환자명 (신원 대조) */
  customerName?: string | null;
  /** fn_customer_birthdates 산출 생년월일 (YYYY-MM-DD) — 나이가드용 */
  birthDateDisplay?: string | null;
  /** 기준 시각 주입 (테스트용) */
  asOfMs?: number;
}

function normalizeName(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, '').trim();
}

/** 필드 + 고객 컨텍스트 → 경고 목록 + 최종 제안 등급 (가드 적용) */
export function evaluateNhisGuards(
  fields: NhisParsedFields,
  ctx: NhisGuardContext,
): { warnings: NhisParseWarning[]; suggestedGrade: NhisCandidateGrade | null } {
  const warnings: NhisParseWarning[] = [];
  let suggestedGrade: NhisCandidateGrade | null = fields.candidateGrade;

  // #4 이름 대조 (최상위 위험)
  if (!fields.patientName) {
    warnings.push({
      code: 'name_missing',
      level: 'warn',
      message: '수진자성명을 결과에서 찾지 못했습니다. 대상 환자가 맞는지 직접 확인해 주세요.',
    });
  } else if (ctx.customerName && normalizeName(fields.patientName) !== normalizeName(ctx.customerName)) {
    warnings.push({
      code: 'name_mismatch',
      level: 'strong',
      message: `⚠ 다른 환자 결과일 수 있습니다 — 조회 성명(${fields.patientName}) ≠ 차트 환자명(${ctx.customerName}). 대상 환자를 반드시 확인하세요.`,
    });
    // 이름 불일치 시 자동 제안 차단 (오조회로 등급 clobber 방지)
    suggestedGrade = null;
  }

  // #1 비화이트리스트 등급
  if (fields.nonWhitelist) {
    warnings.push({
      code: 'non_whitelist',
      level: 'strong',
      message: `자동 저장 불가 등급(${fields.gradeLabelRaw ?? '해당'}) — 시스템에 저장하지 않습니다. 필요 시 등급을 직접 확인해 수기 입력해 주세요.`,
    });
    suggestedGrade = null;
  } else if (!fields.candidateGrade) {
    warnings.push({
      code: 'grade_unresolved',
      level: 'warn',
      message: `자격 등급을 자동으로 읽지 못했습니다${fields.gradeLabelRaw ? ` (읽은 값: ${fields.gradeLabelRaw})` : ''}. 아래에서 직접 등급을 확인해 주세요.`,
    });
  }

  // #2 나이↔등급 clobber 가드 (general 후보에만 적용)
  if (suggestedGrade === 'general') {
    const age = ageFromBirthDate(ctx.birthDateDisplay, ctx.asOfMs);
    if (age != null && age < 6) {
      warnings.push({
        code: 'age_grade_conflict',
        level: 'strong',
        message: `나이 모순 — 만 ${age}세(6세 미만)인데 '건강보험(일반)' 결과입니다. 자동으로 '일반'으로 바꾸지 않습니다(6세미만 등급 확인). 직접 확인 후 선택하세요.`,
      });
      suggestedGrade = null;
    } else if (age != null && age >= 65) {
      warnings.push({
        code: 'age_grade_conflict',
        level: 'warn',
        message: `참고 — 만 ${age}세(65세 이상)입니다. '건강보험(일반)'으로 자동 제안하지 않습니다(65세 정액 등급 여부 확인). 직접 확인 후 선택하세요.`,
      });
      suggestedGrade = null;
    }
  }

  return { warnings, suggestedGrade };
}

/** 파싱 + 가드를 한 번에 (UI 진입점). stamp 는 호출 시각. */
export function parseAndEvaluate(
  rawText: string,
  ctx: NhisGuardContext,
  stamp: number,
): NhisParsedResult {
  const fields = parseNhisEligibilityText(rawText);
  const { warnings, suggestedGrade } = evaluateNhisGuards(fields, ctx);
  return { ...fields, rawText, warnings, suggestedGrade, stamp };
}
