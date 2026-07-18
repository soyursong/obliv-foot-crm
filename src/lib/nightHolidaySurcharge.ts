/**
 * T-20260717-foot-DOCPRINT-NIGHTHOLIDAY-SURCHARGE-AUTOCALC
 * 서류 출력 시 야간·공휴일 가산 자동 판정 + 30% 가산 금액 자동 계산 (FE-only, 출력시점 계산·표시).
 *
 * ⚠ 산식 신규발명 금지 — body 도수센터 canon 포트(REUSE):
 *   T-20260706-body-CHART-BILLING-AUTOMAP-HOLIDAY / T-20260717-body-HOLIDAY-SURCHARGE-AUTO-SELECT.
 *   detectSurchargeKind / isNightOrHoliday / KOREAN_HOLIDAYS_2026 / toLocalDateStr 는
 *   body Chart2InsuranceCalcPanel 구현을 **동일 시그니처·동일 로직**으로 그대로 이식(dev-body 확정값 미러).
 *   가산율 30%, 겹침=공휴일 우선 단일 가산, 야간 기준 18시 이후 = body canon 동일(총괄 확정 4파라미터).
 *
 * body(persist 경로: service_charges origin='auto_calc' + surcharge_kind)와 달리 foot 은
 * **DB 무접촉 FE-only(db_change=false)** — 출력 시점(new Date())에 판정·계산해 금액란에 표시만 한다.
 * 급여 본인부담 분자 이중계상 없음(★가드): 가산은 print 표시 전용이라 Revenue Insurance Split
 * 집계(service_charges)에 영속되지 않으므로 매출 분자에 진입하지 않음(AC-6 구조적 충족).
 */

/** 가산 요율 — 야간/공휴일 공통 30% (의원급 진찰료 표준, body canon 동일). */
export const SURCHARGE_RATE = 0.3;

export type SurchargeKind = 'night' | 'holiday';

/** 가산 종류 한글 라벨. */
export const SURCHARGE_KIND_LABEL: Record<SurchargeKind, string> = {
  night: '야간',
  holiday: '공휴일',
};

/**
 * 2026년 대한민국 법정 공휴일 목록 (YYYY-MM-DD).
 * body canon(KOREAN_HOLIDAYS_2026) 그대로 이식. 출처 = 정부 공공(국가공휴일) 목록(Q3 A안).
 * 제헌절 등 법정목록 밖 임시·대체·시스템 등록 '달력 빨간날'은 clinic_events(event_type='holiday')
 * 소스를 isCalendarHoliday 인자로 합집합 판정(body T-20260717 AC-1/2/3 동일).
 */
export const KOREAN_HOLIDAYS_2026 = new Set<string>([
  '2026-01-01', // 신정
  '2026-01-28', // 설날 전날
  '2026-01-29', // 설날
  '2026-01-30', // 설날 다음날
  '2026-03-01', // 삼일절
  '2026-05-05', // 어린이날
  '2026-05-25', // 석가탄신일
  '2026-06-06', // 현충일
  '2026-08-15', // 광복절
  '2026-09-30', // 추석 전날
  '2026-10-01', // 추석
  '2026-10-02', // 추석 다음날
  '2026-10-03', // 개천절
  '2026-10-09', // 한글날
  '2026-12-25', // 성탄절
]);

/**
 * 로컬 타임존 기준 YYYY-MM-DD 문자열 (body canon 동일).
 * `toISOString().slice(0,10)`은 UTC 변환이라 KST 새벽이 전날로 밀리는 버그가 있어 로컬 날짜로 판정.
 */
export function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 야간·공휴일 가산 대상 여부 (body canon isNightOrHoliday 동일).
 * - 일요일 종일 / 공휴일 종일(법정목록 ∪ 달력 빨간날) / 평일·토 18시 이후.
 * @param refDate 판정 기준 일시(출력 시점 = new Date()).
 * @param isCalendarHoliday clinic_events(event_type='holiday') 달력 빨간날 소스 판정 결과.
 */
export function isNightOrHoliday(refDate: Date, isCalendarHoliday = false): boolean {
  const dow = refDate.getDay(); // 0=Sun, 6=Sat
  const hour = refDate.getHours();
  const dateStr = toLocalDateStr(refDate);

  if (dow === 0) return true; // 일요일 종일
  if (KOREAN_HOLIDAYS_2026.has(dateStr) || isCalendarHoliday) return true; // 공휴일 종일
  if (hour >= 18) return true; // 18시 이후 (평일·토 공통)
  return false;
}

/**
 * 적용 가산 종류 단일 판별 (body canon detectSurchargeKind 동일).
 * 야간+공휴일 동시 성립 시 **공휴일 우선 단일 가산**(합산 X, 겹침규칙 canon 동일):
 *   - 공휴일(법정공휴일 ∪ 일요일 ∪ 달력 빨간날) → 'holiday' (시간대 무관 전일).
 *   - 공휴일 아니고 평일·토 18시 이후 → 'night'.
 *   - 그 외 → null(가산 없음).
 * 반환은 항상 단일 → 이중 가산(합산) 구조적 차단(AC-3).
 */
export function detectSurchargeKind(refDate: Date, isCalendarHoliday = false): SurchargeKind | null {
  const dow = refDate.getDay(); // 0=Sun, 6=Sat
  const hour = refDate.getHours();
  const dateStr = toLocalDateStr(refDate);

  // 공휴일 종일 우선 (법정공휴일 ∪ 일요일 ∪ 달력 빨간날) — 겹쳐도 공휴일 단일 적용
  if (dow === 0 || KOREAN_HOLIDAYS_2026.has(dateStr) || isCalendarHoliday) return 'holiday';
  // 평일·토요일 18시 이후 → 야간
  if (hour >= 18) return 'night';
  return null;
}

/** 체크박스 자동 체크 마크 — 해당 종류면 '■', 아니면 ' '(공란). body night_mark/holiday_mark 패턴 동일. */
export function surchargeMark(kind: SurchargeKind | null, target: SurchargeKind): '■' | ' ' {
  return kind === target ? '■' : ' ';
}

/**
 * 가산 금액 자동 계산 + 급여 본인/공단 비례 분할 (출력시점 표시 전용).
 *
 * 가산 범위(Q4) = **진찰료(급여) base × 30%** — 진료비 전체합산 아님. 가산 금액은 진찰료의
 * 급여 본인부담률(copayment / base)을 그대로 승계해 본인부담분/공단부담분으로 분할한다.
 *
 * @param base  진찰료 급여 총액(= 본인부담금 + 공단부담금).
 * @param copayment 진찰료 급여 본인부담금(비례 분할 기준).
 * @param kind  detectSurchargeKind 결과. null 이면 전부 0(가산 없음, 회귀 방지).
 * @returns amount=가산 총액(반올림), copay=가산 본인부담분, covered=가산 공단부담분(amount-copay).
 */
export function computeSurcharge(
  base: number,
  copayment: number,
  kind: SurchargeKind | null,
): { amount: number; copay: number; covered: number } {
  if (!kind || base <= 0) return { amount: 0, copay: 0, covered: 0 };
  const amount = Math.round(base * SURCHARGE_RATE);
  const ratio = copayment > 0 ? Math.min(1, copayment / base) : 0;
  const copay = Math.round(amount * ratio);
  const covered = Math.max(0, amount - copay);
  return { amount, copay, covered };
}
