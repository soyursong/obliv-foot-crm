/**
 * age.ts — 나이 판정 단일 SSOT (Single Source of Truth)
 *
 * T-20260720-foot-COPAY-AGE-DERIVED-AUTO
 *
 * ★ 목적: 코드베이스에 흩어진 나이/세기 계산 사본을 하나로 수렴한다.
 *   기존 사본:
 *     · src/lib/format.ts            birthYearAgeDisplay  (표시 — 로컬 TZ new Date())
 *     · src/components/doctor/KohReportTab.tsx formatBirthYearWithAge (표시 — 세기 하드코딩 26)
 *     · src/lib/insuranceGradeJudge.ts ageFromBirthValue  (판정보조 — 동적 세기)
 *   → 이 모듈이 유일한 나이 산식이다. 신규 사본 생성 금지(§3·§9).
 *
 * ★ 세기(19/20) 판정 원칙:
 *   · 완전연도(YYYY-MM-DD, 8자리) = 세기 정확. 서버 RPC fn_customer_birthdates 파생값이 정본 소스.
 *     금액 계산(copay)에는 반드시 이 경로만 사용(§3 — 클라이언트 세기 휴리스틱 금지).
 *   · 레거시 2자리(YYMMDD, 6자리) = 동적 세기 경계(yy ≤ 현재연도 2자리 → 2000년대, 아니면 1900년대).
 *     하드코딩 연도 없음 → 2027-01-01 시한폭탄 방지(AC-9). 표시(display) 폴백 전용.
 *
 * ★ 기준 시각: KST 고정. 순수 함수 유지를 위해 호출부가 todayISO(KST 'YYYY-MM-DD')를 주입한다
 *   (visitRecency.ts KST 경계 선례). 로컬 TZ new Date() 로 만나이 경계를 가르지 않는다.
 *
 * 순수 함수 — 외부 의존 없음(import type만).
 */

import type { InsuranceGrade } from './insurance';

// ──────────────────────────────────────────────────────────
// 파싱
// ──────────────────────────────────────────────────────────

export interface ParsedBirth {
  year: number;
  month: number;
  day: number;
  /** 완전연도(YYYY, 세기 정확) 소스인가. false = 레거시 2자리 세기 휴리스틱(계산 부적격). */
  exactCentury: boolean;
}

/**
 * 생년 문자열 → {year, month, day, exactCentury} | null.
 *
 * @param birth    'YYYY-MM-DD'(완전연도) | 'YYMMDD'(레거시) | 하이픈·점 등 구분자 포함 허용.
 * @param todayISO 세기 경계 판정 기준(KST 'YYYY-MM-DD'). 레거시 6자리에만 사용.
 */
export function parseBirth(
  birth: string | null | undefined,
  todayISO: string,
): ParsedBirth | null {
  if (!birth) return null;
  const digits = String(birth).replace(/\D/g, '');
  if (digits.length < 6) return null;

  let year: number;
  let month: number;
  let day: number;
  let exactCentury: boolean;

  if (digits.length >= 8) {
    // YYYYMMDD — 완전연도(세기 정확). RPC 'YYYY-MM-DD' 소스.
    year = Number(digits.slice(0, 4));
    month = Number(digits.slice(4, 6));
    day = Number(digits.slice(6, 8));
    exactCentury = true;
    const curYear = Number(todayISO.slice(0, 4));
    if (Number.isNaN(year) || year < 1850 || (Number.isFinite(curYear) && year > curYear)) return null;
  } else {
    // YYMMDD — 레거시 2자리(동적 세기 경계, 하드코딩 없음).
    const yy = Number(digits.slice(0, 2));
    month = Number(digits.slice(2, 4));
    day = Number(digits.slice(4, 6));
    exactCentury = false;
    if (Number.isNaN(yy)) return null;
    const curYY = Number(todayISO.slice(2, 4)); // 현재연도 뒤 2자리 (KST 기준)
    if (Number.isNaN(curYY)) return null;
    year = (yy <= curYY ? 2000 : 1900) + yy;
  }

  if (Number.isNaN(month) || Number.isNaN(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day, exactCentury };
}

// ──────────────────────────────────────────────────────────
// 만나이
// ──────────────────────────────────────────────────────────

/**
 * 만나이(Korean age) 계산. 생일 당일 포함 = 그날부터 나이 증가(경계 가드, AC-1/AC-2).
 * @param todayISO 기준일 KST 'YYYY-MM-DD'.
 */
export function computeAge(b: ParsedBirth, todayISO: string): number | null {
  const ty = Number(todayISO.slice(0, 4));
  const tm = Number(todayISO.slice(5, 7));
  const td = Number(todayISO.slice(8, 10));
  if (Number.isNaN(ty) || Number.isNaN(tm) || Number.isNaN(td)) return null;
  let age = ty - b.year;
  // 올해 생일이 아직 안 지났으면 -1 (생일 당일은 지난 것으로 간주 = 즉시 적용).
  if (tm < b.month || (tm === b.month && td < b.day)) age -= 1;
  if (age < 0 || age > 130) return null;
  return age;
}

/**
 * 생년 문자열 → 만나이 | null. (parseBirth + computeAge)
 * insuranceGradeJudge.ageFromBirthValue / format.birthYearAgeDisplay 가 위임하는 SSOT.
 */
export function ageFromBirth(
  birth: string | null | undefined,
  todayISO: string,
): number | null {
  const p = parseBirth(birth, todayISO);
  if (!p) return null;
  return computeAge(p, todayISO);
}

/**
 * 생년 표시 라벨 "1990 (만 35세)". 나이 이상치/미상이면 연도만 또는 ''.
 * format.ts birthYearAgeDisplay 위임 대상(표시 전용).
 */
export function birthYearAgeLabel(
  birth: string | null | undefined,
  todayISO: string,
): string {
  const p = parseBirth(birth, todayISO);
  if (!p) return '';
  const age = computeAge(p, todayISO);
  if (age == null) return String(p.year); // 이상치 → 연도만
  return `${p.year} (만 ${age}세)`;
}

// ──────────────────────────────────────────────────────────
// KST today 헬퍼
// ──────────────────────────────────────────────────────────

/**
 * 현재 KST 날짜 'YYYY-MM-DD'. UTC 기반 계산(로컬 TZ 무관) → Asia/Seoul(+9h) 날짜.
 * @param nowMs 기본 Date.now(). 테스트 결정성 위해 주입 허용.
 */
export function kstTodayISO(nowMs: number = Date.now()): string {
  return new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ──────────────────────────────────────────────────────────
// 나이 파생 본인부담 (elderly_flat · infant) — COPAY-AGE-DERIVED 핵심
// ──────────────────────────────────────────────────────────

export type AgeCopayKind =
  | 'elderly_flat'   // 만65세 이상 → 노인 외래 정률제 4구간
  | 'infant_under1'  // 1세미만 → 외래 5%
  | 'infant_under6'  // 1세이상 6세미만 → 외래 21%
  | null;            // 그 외(만6~64세) → 나이 파생 없음

export interface AgeCopayDerivation {
  kind: AgeCopayKind;
  /** 파생 등급('elderly_flat' | 'infant' | null). copayCalc grade 로 전달. */
  grade: InsuranceGrade | null;
  /**
   * 정률 override(0~1) | null. <1세 → 0.05(5%). 1~<6세 → null(infant 기본 0.21 사용).
   * ≥65 → null(elderly_flat 4구간 = copayFromBase 자체 분기).
   * 소비지점은 이 값을 copayment_rate_override 로 넘겨 <1세 5%를 적용한다.
   */
  rateOverride: number | null;
  ageYears: number | null;
  /**
   * 나이 판정 불가(생년 미상: birth_date NULL + rrn NULL → RPC 도 NULL) → 계산 차단.
   * AC-8: 임의 폴백(30%) 금지 — 금액 확정 금지·자격 미확인 입력 강제.
   */
  blocked: boolean;
  reason: string;
}

/**
 * 생년월일(완전연도 우선) → 나이 파생 본인부담 판정.
 *
 * 규칙(국민건강보험법 시행령 별표2 연령별 본인부담):
 *   · 만 65세 이상 (의원급 외래)  → elderly_flat (4구간 정률제, copayFromBase)
 *   · 만 1세 미만               → infant + 5% (rateOverride 0.05)
 *   · 만 1세 이상 6세 미만       → infant (21%)
 *   · 만 6세 이상 65세 미만      → 파생 없음(null) → 등급/일반 로직에 위임
 *
 * ★ 계산 부적격 입력 처리(AC-8): birth 미상(parse 불가) → blocked=true.
 *   금액을 만들지 않는다(30% 임의 폴백 금지). 소비지점은 입력 강제·확정 차단.
 *
 * ★ 세기 정확성(§3): 완전연도(exactCentury) 아니면 계산용으로 신뢰하지 않는다.
 *   레거시 2자리(휴리스틱)만 있으면 → 65세 경계(1961 vs 2061 등) 오판 위험 → blocked.
 *   (표시용 birthYearAgeLabel 은 레거시 허용, 계산용 deriveAgeCopay 는 완전연도 강제.)
 *
 * @param birth    완전연도 'YYYY-MM-DD' 권장(RPC fn_customer_birthdates). 레거시는 blocked.
 * @param todayISO 기준일 KST 'YYYY-MM-DD'.
 */
export function deriveAgeCopay(
  birth: string | null | undefined,
  todayISO: string,
): AgeCopayDerivation {
  const p = parseBirth(birth, todayISO);
  if (!p) {
    return {
      kind: null, grade: null, rateOverride: null, ageYears: null,
      blocked: true,
      reason: '생년월일 미상(자격 미확인) — 계산 차단(임의 폴백 금지, AC-8)',
    };
  }
  // 계산은 완전연도(세기 정확)만 신뢰. 레거시 2자리 → 세기 오판 위험 → 차단.
  if (!p.exactCentury) {
    return {
      kind: null, grade: null, rateOverride: null, ageYears: null,
      blocked: true,
      reason: '레거시 2자리 생년(세기 불확실) — 계산용 신뢰 불가, 완전연도(RPC) 확인 필요',
    };
  }
  const age = computeAge(p, todayISO);
  if (age == null) {
    return {
      kind: null, grade: null, rateOverride: null, ageYears: null,
      blocked: true,
      reason: '나이 산출 불가(이상치) — 계산 차단',
    };
  }
  if (age >= 65) {
    return {
      kind: 'elderly_flat', grade: 'elderly_flat', rateOverride: null, ageYears: age,
      blocked: false, reason: `만 ${age}세 → 노인 외래 정률제(elderly_flat)`,
    };
  }
  if (age < 1) {
    return {
      kind: 'infant_under1', grade: 'infant', rateOverride: 0.05, ageYears: age,
      blocked: false, reason: `만 ${age}세(1세미만) → 외래 5%`,
    };
  }
  if (age < 6) {
    return {
      kind: 'infant_under6', grade: 'infant', rateOverride: null, ageYears: age,
      blocked: false, reason: `만 ${age}세(6세미만) → 외래 21%`,
    };
  }
  return {
    kind: null, grade: null, rateOverride: null, ageYears: age,
    blocked: false, reason: `만 ${age}세 → 나이 파생 없음(등급/일반 로직)`,
  };
}

/**
 * 저장 등급 + 나이 파생 → 실효 등급 판정.
 *
 * 우선순위(insuranceGradeJudge §3 정합):
 *   · 급여종별(의급/차상위)·외국인 확정 등급 → 나이보다 우선(변경 없음).
 *   · general / unverified / null 인 경우에만 나이 파생(elderly_flat·infant)을 적용.
 *   · 나이 파생이 blocked(생년 미상) 이고 저장 등급도 미확정(unverified/null)  →
 *     blocked=true 전파(계산 차단, AC-8). 저장 등급이 확정(general 등)이면 그 등급으로 진행.
 *
 * @returns grade=실효 등급, rateOverride=<1세 5% 등, blocked=계산 차단 여부.
 */
export function resolveEffectiveGrade(
  storedGrade: InsuranceGrade | null | undefined,
  ageDeriv: AgeCopayDerivation,
): { grade: InsuranceGrade | null; rateOverride: number | null; blocked: boolean; reason: string } {
  const benefitOrForeigner =
    storedGrade === 'medical_aid_1' || storedGrade === 'medical_aid_2' ||
    storedGrade === 'low_income_1' || storedGrade === 'low_income_2' ||
    storedGrade === 'foreigner' ||
    storedGrade === 'infant' || storedGrade === 'elderly_flat';

  // 이미 확정 등급(급여종별/외국인/명시 infant·elderly) → 그대로. 나이 파생 무시.
  if (benefitOrForeigner) {
    return { grade: storedGrade!, rateOverride: null, blocked: false, reason: '확정 등급 우선(나이 파생 미적용)' };
  }

  // general / unverified / null → 나이 파생 우선.
  if (ageDeriv.grade) {
    return {
      grade: ageDeriv.grade,
      rateOverride: ageDeriv.rateOverride,
      blocked: false,
      reason: `나이 파생: ${ageDeriv.reason}`,
    };
  }

  // 나이 파생 없음(만6~64세) 또는 판정 불가.
  if (ageDeriv.blocked) {
    // 저장 등급이 general(급여 확정 아님이지만 일반 30%로 진행 가능)이면 general 유지,
    // unverified/null 이면 계산 차단 전파(AC-8).
    if (storedGrade === 'general') {
      return { grade: 'general', rateOverride: null, blocked: false, reason: '일반 등급(나이 파생 불가·general 유지)' };
    }
    return { grade: null, rateOverride: null, blocked: true, reason: `자격 미확인 + ${ageDeriv.reason}` };
  }

  // 만6~64세, general/unverified/null → 저장 등급 그대로(없으면 null).
  return { grade: storedGrade ?? null, rateOverride: null, blocked: false, reason: '나이 파생 없음(등급 유지)' };
}
