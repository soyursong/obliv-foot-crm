/**
 * customerAge.ts — 고객 나이(만나이) + 나이 파생 본인부담 등급 단일 SSOT
 *
 * T-20260720-foot-COPAY-AGE-DERIVED-AUTO
 *
 * ★ 목적: 나이 판정 규칙을 **코드베이스 단 한 곳**에 둔다. 종전 3벌(format.ts birthYearAgeDisplay /
 *   KohReportTab formatBirthYearWithAge / insuranceGradeJudge ageFromBirthValue)이 세기 판정·경계
 *   규칙이 제각각이라 재발원인 1위(사본 증식) 패턴이었다. 이 파일이 유일 정의 지점 — 표시(format/Koh)
 *   와 계산(copay 등급 파생)은 모두 이 함수를 위임 소비한다(신규 사본 생성 금지, §3/§9).
 *
 * ★ 세기(19/20세기) 판정 원칙:
 *   1) 서버 RPC fn_customer_birthdates 파생값 'YYYY-MM-DD'(완전연도, 세기 정확) = 1순위 소스.
 *      digits 8자리 → 세기추정 불요(정확). 금액계산 경로는 반드시 이 소스를 쓴다(§3).
 *   2) 레거시 6자리(YYMMDD)만 있을 때의 폴백은 **동적 세기 경계**(하드코딩 연도 금지):
 *        yy ≤ (기준연도 % 100) → 2000년대, 아니면 1900년대.
 *      기준연도를 **인자(todayISO, KST)** 로 받으므로 2027 시한폭탄(하드코딩 26 → 27년생 오판) 없음(AC-9).
 *   ⚠ 클라이언트 세기 휴리스틱(format.ts:212 yy<=curYY)의 단독 사용은 금액계산에서 금지 —
 *      1926년생(만100세)을 2026년생(0세)으로 오판할 수 있어(age>130 가드도 age=0이라 무력) 노인정액
 *      대상에 영유아 5%를 적용할 위험이 있다. 이 SSOT 는 8자리(RPC) 소스를 정확판정으로 흡수한다(AC-3).
 *
 * ★ 기준 시각은 KST 고정: 모든 함수가 refISO('YYYY-MM-DD', 서울 기준)를 인자로 받는다.
 *   호출부는 todaySeoulISODate()(format.ts) 를 넘긴다. new Date() 로컬 TZ 직접 사용 금지(§5).
 *   순수 함수(외부의존 0) — 테스트 결정성 보장.
 */

import type { InsuranceGrade } from './insurance';

// ──────────────────────────────────────────────────────────
// 생년 파싱 (세기 정확판정 우선, 레거시 6자리는 동적 세기 폴백)
// ──────────────────────────────────────────────────────────

export interface BirthYMD {
  /** 완전 서기연도 (예: 1961, 2026). */
  year: number;
  /** 월 1~12 */
  month: number;
  /** 일 1~31 */
  day: number;
}

/** 'YYYY-MM-DD' / 'YYYY.MM.DD' / 8자리 YYYYMMDD 인가 (완전연도 = 세기 정확). */
function isFullYearForm(digits: string): boolean {
  return digits.length >= 8;
}

/**
 * 생년 문자열 → {year, month, day} | null.
 *
 * @param birth   'YYYY-MM-DD'(RPC 파생, 8자리) 또는 레거시 6자리 YYMMDD. 구분자 무관.
 * @param todayISO 'YYYY-MM-DD'(KST). 6자리 폴백의 동적 세기 경계 기준연도.
 */
export function parseBirthYMD(
  birth: string | null | undefined,
  todayISO: string,
): BirthYMD | null {
  if (!birth) return null;
  const digits = String(birth).replace(/\D/g, '');
  if (digits.length < 6) return null;

  const todayYear = Number(todayISO.slice(0, 4));
  if (!Number.isFinite(todayYear)) return null;

  let year: number;
  let month: number;
  let day: number;

  if (isFullYearForm(digits)) {
    // YYYYMMDD (완전연도, 세기 정확 — RPC 'YYYY-MM-DD' 소스). 세기 추정 불요.
    year = Number(digits.slice(0, 4));
    month = Number(digits.slice(4, 6));
    day = Number(digits.slice(6, 8));
    if (!Number.isFinite(year) || year < 1850 || year > todayYear) return null;
  } else {
    // YYMMDD (레거시 2자리연도) — 동적 세기 경계(하드코딩 연도 금지, 시한폭탄 방지).
    const yy = Number(digits.slice(0, 2));
    month = Number(digits.slice(2, 4));
    day = Number(digits.slice(4, 6));
    if (!Number.isFinite(yy)) return null;
    const curYY = todayYear % 100;
    year = (yy <= curYY ? 2000 : 1900) + yy;
  }

  if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

// ──────────────────────────────────────────────────────────
// 만나이 계산 (KST 고정, 생일 당일 포함)
// ──────────────────────────────────────────────────────────

/**
 * 생년 → 만나이(세) | null. 기준일 = todayISO(KST). 생일 당일 = 만나이 도달(경계 포함, AC-1).
 *
 * 경계 규약: 올해 생일이 아직 안 지났으면(월 미도달 또는 동월 일 미도달) −1.
 *   · 1961-07-20 / 오늘 2026-07-20(생일당일) → 만65세 (AC-1)
 *   · 1961-07-21 / 오늘 2026-07-20(생일전날) → 만64세 (AC-2)
 * 이상치(음수·>130)면 null(호출부가 '—'/차단 처리).
 */
export function computeAgeFromBirth(
  birth: string | null | undefined,
  todayISO: string,
): number | null {
  const p = parseBirthYMD(birth, todayISO);
  if (!p) return null;
  const ty = Number(todayISO.slice(0, 4));
  const tmo = Number(todayISO.slice(5, 7));
  const td = Number(todayISO.slice(8, 10));
  if (!Number.isFinite(ty) || !Number.isFinite(tmo) || !Number.isFinite(td)) return null;

  let age = ty - p.year;
  // 올해 생일 미경과 → 만나이 −1 (생일 당일은 경과로 취급 = 만나이 도달).
  if (tmo < p.month || (tmo === p.month && td < p.day)) age -= 1;
  if (age < 0 || age > 130) return null;
  return age;
}

// ──────────────────────────────────────────────────────────
// 나이 파생 본인부담 등급 (핵심: 외부 자격조회 없이 확정 가능한 축)
// ──────────────────────────────────────────────────────────

/** 만 65세 이상 = 노인 외래 정률제 대상. */
export const ELDERLY_AGE_THRESHOLD = 65;
/** 만 6세 미만 = 영유아 본인부담(외래) 대상. */
export const INFANT_AGE_CEILING = 6;
/** 만 1세 미만 외래 본인부담률(시행령 별표2). */
export const INFANT_UNDER1_RATE = 0.05;
/** 만 1세 이상 6세 미만 외래 본인부담률(부담률의 70% = 21%, 시행령 별표2). */
export const INFANT_UNDER6_RATE = 0.21;

/**
 * 나이 파생 본인부담 결정. **외부 자격조회가 필요 없는** 65세 노인정액·영유아만 확정한다.
 *
 *  · 만 65세 이상        → { grade:'elderly_flat', rate:null } (노인 외래 4구간 정률제, copayFromBase 처리)
 *  · 만 1세 미만         → { grade:'infant',       rate:0.05 } (1세미만 외래 5%)
 *  · 만 1~5세(6세미만)   → { grade:'infant',       rate:0.21 } (6세미만 외래 21%)
 *  · 그 외(만 6~64세)    → null (일반 인구 — 나이만으로 특례 없음, 기존 등급/폴백 유지)
 *  · 생년 파싱 불가      → null (나이 판정 불가 → 등급 **날조 금지**. AC-8: 임의 폴백 금지)
 *
 * ⚠ rate 는 infant 세부율(5/21%) 전달용. elderly_flat 은 4구간이라 rate=null(copayFromBase 가 base 로 분기).
 * ⚠ 이 함수는 자격등급(의료급여·차상위·산정특례)을 판정하지 않는다 — 그 축은 조회 필요(§6).
 */
export interface AgeCopayGrade {
  grade: Extract<InsuranceGrade, 'elderly_flat' | 'infant'>;
  /** infant 세부 본인부담률(1세미만 0.05 / 6세미만 0.21). elderly_flat 은 null(4구간). */
  rate: number | null;
  /** 판정에 사용된 만나이(세). */
  age: number;
}

export function deriveAgeCopayGrade(
  birth: string | null | undefined,
  todayISO: string,
): AgeCopayGrade | null {
  const age = computeAgeFromBirth(birth, todayISO);
  if (age == null) return null; // 나이 미상 → 등급 날조 금지(AC-8)
  if (age >= ELDERLY_AGE_THRESHOLD) return { grade: 'elderly_flat', rate: null, age };
  if (age < 1) return { grade: 'infant', rate: INFANT_UNDER1_RATE, age };
  if (age < INFANT_AGE_CEILING) return { grade: 'infant', rate: INFANT_UNDER6_RATE, age };
  return null; // 만 6~64세 = 일반 인구(나이 특례 없음)
}

// ──────────────────────────────────────────────────────────
// 등급 해소 (나이 파생을 stored 등급에 얹는 단일 규칙)
// ──────────────────────────────────────────────────────────

export interface ResolvedGradeWithAge {
  /** 최종 적용 등급(나이 파생 우선 반영). */
  grade: InsuranceGrade | null;
  /** 나이 파생으로 결정됐는가(elderly_flat/infant 자동판정). */
  ageDerived: boolean;
  /** infant 세부율(있으면). elderly_flat/그 외 = null. */
  rate: number | null;
}

/**
 * stored 등급 + 생년 → 최종 적용 등급.
 *
 * ★ 나이 파생은 stored 등급이 **null/unverified 일 때만** 개입한다(등급 미설정 89% 대응).
 *   명시 등급(general·의급·차상위·외국인 등)은 절대 덮지 않는다 — 스태프/조회 확정값 보존(§2, 회귀 0).
 * ★ 자격 미확인 + 나이도 미상(생년 파싱 불가) → 나이 파생 없음(등급 날조 금지). stored(null) 그대로
 *   반환해 기존 폴백 경로에 위임(AC-8: 임의 폴백 금지 = 나이 파생을 억지로 만들지 않음).
 */
export function resolveEffectiveGradeWithAge(
  storedGrade: InsuranceGrade | null | undefined,
  birth: string | null | undefined,
  todayISO: string,
): ResolvedGradeWithAge {
  const stored = storedGrade ?? null;
  // 명시 등급(unverified 제외)은 미접촉.
  if (stored && stored !== 'unverified') {
    return { grade: stored, ageDerived: false, rate: null };
  }
  const ag = deriveAgeCopayGrade(birth, todayISO);
  if (ag) return { grade: ag.grade, ageDerived: true, rate: ag.rate };
  return { grade: stored, ageDerived: false, rate: null };
}
