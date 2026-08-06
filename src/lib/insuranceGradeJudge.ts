/**
 * 건강보험 자격등급 "판정 보조" — 순수 매칭 로직 (SSOT)
 *
 * T-20260729-foot-INSURANCE-GRADE-JUDGE-ASSIST
 *
 * ★목적: 데스크가 요양기관정보마당 조회결과의 **값만 각 칸에 긁어 붙이면**(또는 드롭다운 선택),
 *   이 모듈이 **필드별 좁은 키워드 매칭**으로 9등급 중 하나를 **추천**한다.
 *   추천일 뿐 — 최종 확정은 사람(InsuranceGradeSelect 9등급 버튼 → 기존 updateInsuranceGrade 저장).
 *
 * ★안 헷갈리게(오입력=오판정 방지) / 환수 벡터 차단 원칙:
 *  1. 조회결과 전체 자유파싱 금지(T-20260724 PARSER-REMOVE 사고). **필드별로 넣은 값만** 좁게 매칭.
 *  2. 등급 자동확정 금지 — 이 모듈은 recommend만 반환. write 없음.
 *  3. 억지 매핑 금지 = 매칭 실패 시 무조건 `unverified` 안전 폴백(환수 방지).
 *  4. §2 하드닝: "희귀난치·중증·보훈"은 **"차상위" 동시 출현 시에만** low_income_1.
 *     단독 출현 = 산정특례(본인부담 5~10%)일 수 있어 무조건 `unverified`(오분류=환수).
 *  5. 등급 enum/CHECK/copayFromBase/COVERED_GRADES 무접촉 — 판정 보조만.
 *
 * 매칭은 "포함검사"(대소문자·공백 무시)라 표기가 조금 달라도 대부분 잡히고,
 * 안 잡히면 §4 미확인으로 안전 폴백 → 착수/운영을 막지 않음(§7 안전 상위집합).
 */

import type { InsuranceGrade } from './insurance';
// T-20260720-foot-COPAY-AGE-DERIVED-AUTO: 나이 산식 SSOT(age.ts) 위임 (사본 제거).
import { ageFromBirth, kstTodayISO } from './age';

// ── 입력/출력 타입 ────────────────────────────────────────────────────────────

export interface JudgeInput {
  /** "급여 종류" 칸: 조회결과의 가입자·급여 표시(예: "건강보험", "의료급여 1종") */
  benefitText: string;
  /** "본인부담 경감" 칸: 차상위·경감 표시(없으면 공란) */
  reliefText: string;
  /** 외국인 체크박스 */
  isForeigner: boolean;
  /** 만나이(세). 서버 RPC(fn_customer_birthdates) 파생값 기준. 미상이면 null → 나이 추천 생략(§3). */
  ageYears: number | null;
}

/** 한 칸의 "인식 에코" — 붙여넣는 즉시 무엇으로 읽혔는지 표시(§1 UX2/3). */
export interface FieldEcho {
  /** 입력이 비었으면 true → 에코 미표시 */
  empty: boolean;
  /** 인식 성공 시 라벨(예: "의료급여 1종"), 실패 시 null(회색 안내) */
  recognized: string | null;
}

export interface JudgeResult {
  /** 최종 추천 등급. 빈칸/애매 → null(§1.6 자동선택 0). */
  recommended: InsuranceGrade | null;
  /** 추천 사유(사람이 확인·확정에 참고). */
  reason: string;
  /** unverified 추천 = 메모에 사유 기록 안내 필요(§4). */
  needsMemoNote: boolean;
  /** 필드별 인식 에코 */
  echo: {
    benefit: FieldEcho;
    relief: FieldEcho;
    foreigner: FieldEcho;
  };
}

// ── 정규화 · 포함검사 ─────────────────────────────────────────────────────────

/** 공백 제거 + 소문자화(라틴 문자만 영향; 한글 무영향). 포함검사 전 정규화. */
function norm(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, '').toLowerCase();
}

/** normalizedText 가 kw(정규화) 를 포함하는가. */
function has(normalizedText: string, kw: string): boolean {
  return normalizedText.includes(norm(kw));
}

// ── 드롭다운 옵션(붙여넣기 대신 목록에서 선택, §1 UX4) ──────────────────────────

/** "급여 종류" 드롭다운 옵션 — value 는 그대로 benefitText 로 주입(동일 매칭 경로). */
export const BENEFIT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '(선택 안 함 / 직접 붙여넣기)' },
  { value: '건강보험', label: '건강보험 (직장·지역)' },
  { value: '의료급여 1종', label: '의료급여 1종' },
  { value: '의료급여 2종', label: '의료급여 2종' },
];

/** "본인부담 경감" 드롭다운 옵션. */
export const RELIEF_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '(없음 / 직접 붙여넣기)' },
  { value: '차상위 1종', label: '차상위 1종 (희귀난치·중증)' },
  { value: '차상위 2종', label: '차상위 2종 (만성)' },
];

// ── 위험(단독 출현 시 unverified) 키워드 — §2 하드닝 / §4 ──────────────────────
// 이 단어들이 "차상위" 없이 단독 출현하면 산정특례(5~10%)·희귀난치(10%, 차상위 아님)·
// 보훈(국가유공) 가능성 → 9등급 대응 없음 → 무조건 unverified(오분류=환수).
const RISK_SOLO_KEYWORDS = ['산정특례', '희귀난치', '중증', '보훈', '국가유공'];

// ── 인식 에코(필드별) ─────────────────────────────────────────────────────────

function echoBenefit(benefitText: string): FieldEcho {
  const t = norm(benefitText);
  if (!t) return { empty: true, recognized: null };
  if (has(t, '의료급여')) {
    if (has(t, '1종')) return { empty: false, recognized: '의료급여 1종' };
    if (has(t, '2종')) return { empty: false, recognized: '의료급여 2종' };
    return { empty: false, recognized: null }; // 종별 불명 → 회색 안내
  }
  if (has(t, '건강보험') || has(t, '직장') || has(t, '지역')) {
    return { empty: false, recognized: '건강보험(일반)' };
  }
  return { empty: false, recognized: null };
}

function echoRelief(reliefText: string): FieldEcho {
  const t = norm(reliefText);
  if (!t) return { empty: true, recognized: null };
  if (has(t, '차상위')) {
    if (has(t, '2종') || has(t, '만성')) return { empty: false, recognized: '차상위 2종' };
    if (has(t, '1종') || has(t, '희귀난치') || has(t, '희귀') || has(t, '중증')) {
      return { empty: false, recognized: '차상위 1종' };
    }
    return { empty: false, recognized: null }; // 차상위인데 종별 불명 → 회색(§4)
  }
  // 차상위 없이 위험키워드 단독 → 인식 안 됨(회색). 산정특례/희귀난치/보훈은 등급 대응 없음.
  return { empty: false, recognized: null };
}

// ── 텍스트 → 등급 매칭(§2 + §4) ───────────────────────────────────────────────

interface TextMatch {
  grade: InsuranceGrade | null; // null = 빈칸(입력 없음)
  reason: string;
  needsMemoNote: boolean;
}

function matchFromText(benefitText: string, reliefText: string, isForeigner: boolean): TextMatch {
  const benefit = norm(benefitText);
  const relief = norm(reliefText);
  const combined = benefit + relief;

  // (0) 외국인 — 체크박스 또는 키워드
  if (isForeigner || has(combined, '외국인')) {
    return { grade: 'foreigner', reason: '외국인 → 외국인(비급여)', needsMemoNote: false };
  }

  const anyInput = combined.length > 0;

  // (1) 의료급여 (benefit 칸 우선)
  if (has(combined, '의료급여')) {
    if (has(combined, '1종')) {
      return { grade: 'medical_aid_1', reason: '의료급여 + 1종 → 의료급여1', needsMemoNote: false };
    }
    if (has(combined, '2종')) {
      return { grade: 'medical_aid_2', reason: '의료급여 + 2종 → 의료급여2', needsMemoNote: false };
    }
    return {
      grade: 'unverified',
      reason: '의료급여인데 종별(1/2)이 값에 없음 — 확정 불가',
      needsMemoNote: true,
    };
  }

  // (2) 차상위 (relief 칸)
  if (has(combined, '차상위')) {
    // 2종 먼저(만성·2종) — 그 다음 1종(희귀난치·중증)
    if (has(combined, '2종') || has(combined, '만성')) {
      return { grade: 'low_income_2', reason: '차상위 + 2종/만성 → 차상위2', needsMemoNote: false };
    }
    if (
      has(combined, '1종') ||
      has(combined, '희귀난치') ||
      has(combined, '희귀') ||
      has(combined, '중증')
    ) {
      return { grade: 'low_income_1', reason: '차상위 + 1종/희귀난치/중증 → 차상위1', needsMemoNote: false };
    }
    // §4: 차상위인데 종별(1/2)이 값에 없음 → 부담률 확정 불가
    return {
      grade: 'unverified',
      reason: '차상위인데 종별(1/2)이 값에 없음 — 종별이 부담률을 가르므로 확정 불가',
      needsMemoNote: true,
    };
  }

  // (3) §2 하드닝 / §4: 위험키워드 단독 출현(차상위 없음) → 무조건 unverified
  //     산정특례(5%)·희귀난치(10%)·보훈(국가유공) — 9등급 대응 없음. 차상위1(면제) 오분류 = 환수.
  const soloRisk = RISK_SOLO_KEYWORDS.find((kw) => has(combined, kw));
  if (soloRisk) {
    return {
      grade: 'unverified',
      reason: `"${soloRisk}" 단독 출현(차상위 아님) — 산정특례/희귀난치/보훈 가능, 9등급 대응 없음. 메모에 사유 기록 후 수동 확인`,
      needsMemoNote: true,
    };
  }

  // (4) 건강보험/직장/지역 (경감·차상위 없음) → 일반
  if (has(combined, '건강보험') || has(combined, '직장') || has(combined, '지역')) {
    return { grade: 'general', reason: '건강보험(경감·차상위 없음) → 일반', needsMemoNote: false };
  }

  // (5) 빈칸이면 null(추천 없음), 값이 있는데 안 걸리면 unverified 안전 폴백
  if (!anyInput) {
    return { grade: null, reason: '', needsMemoNote: false };
  }
  return {
    grade: 'unverified',
    reason: '입력값이 매칭 규칙에 걸리지 않음 — 아래에서 직접 선택(억지 추측 안 함)',
    needsMemoNote: true,
  };
}

// ── 나이 → 등급 후보(§3) ──────────────────────────────────────────────────────

/** 만나이 → 나이 기반 등급 후보. 6세 미만=infant / 65세 이상=elderly_flat / 그 외=null. */
function ageCandidate(ageYears: number | null): InsuranceGrade | null {
  if (ageYears == null || !Number.isFinite(ageYears) || ageYears < 0) return null;
  if (ageYears < 6) return 'infant';
  if (ageYears >= 65) return 'elderly_flat';
  return null;
}

/** 급여종별 등급(나이보다 우선) 여부 — 의료급여·차상위. */
function isBenefitGrade(g: InsuranceGrade | null): boolean {
  return g === 'medical_aid_1' || g === 'medical_aid_2' || g === 'low_income_1' || g === 'low_income_2';
}

// ── 최종 판정(텍스트 + 나이 종합, §3 우선순위) ────────────────────────────────

export function judgeInsuranceGrade(input: JudgeInput): JudgeResult {
  const { benefitText, reliefText, isForeigner, ageYears } = input;

  const textMatch = matchFromText(benefitText, reliefText, isForeigner);
  const ageGrade = ageCandidate(ageYears);

  const echo = {
    benefit: echoBenefit(benefitText),
    relief: echoRelief(reliefText),
    foreigner: { empty: !isForeigner, recognized: isForeigner ? '외국인' : null } as FieldEcho,
  };

  // §3 우선순위: 급여종별(의급/차상위) 우선 — 나이정액은 "일반 건보 대상"일 때만.
  let recommended = textMatch.grade;
  let reason = textMatch.reason;
  let needsMemoNote = textMatch.needsMemoNote;

  if (isBenefitGrade(textMatch.grade) || textMatch.grade === 'foreigner') {
    // 급여종별·외국인 확정 → 나이 무시(충돌 시 급여종별 우선).
    // (recommended 그대로)
  } else if (textMatch.grade === 'general' || textMatch.grade === null) {
    // 일반 건보 대상(또는 빈칸)일 때만 나이정액/영유아 적용.
    if (ageGrade === 'infant') {
      recommended = 'infant';
      reason = textMatch.grade === 'general'
        ? '건강보험 + 만 6세 미만 → 6세미만'
        : '만 6세 미만 → 6세미만 (건보 기준, 급여종별 확인 요망)';
      needsMemoNote = false;
    } else if (ageGrade === 'elderly_flat') {
      recommended = 'elderly_flat';
      reason = textMatch.grade === 'general'
        ? '건강보험 + 만 65세 이상 → 65세정액'
        : '만 65세 이상 → 65세정액 (건보 기준, 급여종별 확인 요망)';
      needsMemoNote = false;
    }
    // ageGrade null → textMatch.grade 그대로(general 또는 null)
  }
  // textMatch.grade === 'unverified' → 나이 적용 안 함(일반 건보 대상 아님). unverified 유지.

  return { recommended, reason, needsMemoNote, echo };
}

// ── 나이 계산 유틸(RPC 미가용 시 폴백) ────────────────────────────────────────

/**
 * 생년 문자열 → 만나이(number) | null.
 *
 * 우선 소스는 서버 RPC(fn_customer_birthdates) 파생값 'YYYY-MM-DD'(완전연도, 세기 정확) —
 * 호출부가 이 값을 넘긴다(REDEFINITION_RISK: 나이 SSOT=RPC 재사용, 클라 세기-휴리스틱 신설 금지).
 *
 * RPC 미가용 폴백으로 YYMMDD(2자리 연도)도 흡수하되 세기 경계를 **동적**으로 안전 처리
 * (하드코딩 연도 없음 → 2027 시한폭탄 방지). format.ts birthYearAgeDisplay 와 동일한
 * 동적 규칙(yy ≤ 현재연도 2자리 → 2000년대, 아니면 1900년대)을 재사용.
 *
 * @param nowMs 현재시각(ms). 순수함수 유지(테스트 결정성) — 호출부가 Date.now() 주입.
 */
export function ageFromBirthValue(
  birth: string | null | undefined,
  nowMs: number,
): number | null {
  // T-20260720-foot-COPAY-AGE-DERIVED-AUTO §3·AC-10: 나이 산식 SSOT(age.ts) 위임.
  //   자체 사본 제거 → 기준시각 KST 고정(로컬 TZ new Date(nowMs) → kstTodayISO).
  return ageFromBirth(birth, kstTodayISO(nowMs));
}
