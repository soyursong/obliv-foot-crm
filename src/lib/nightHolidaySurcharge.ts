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

import { formatAmount } from '@/lib/format';

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

/** 금액 문자열 → 숫자 (콤마·통화기호 제거, NaN 가드). */
function parseAmt(v: string | undefined): number {
  if (v == null || v === '') return 0;
  const n = Number(v.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * ── T-20260717-foot-DOCPRINT-NIGHTHOLIDAY-SURCHARGE-AUTOCALC (reopen 2026-07-19, field-soak FAIL RC) ──
 * 출력 시점 야간·공휴일 가산을 대상 서류 값 번들에 자동 반영하는 **단일 SSOT 헬퍼**.
 *
 * ⚠ reopen RC(스펙-구현 divergence): reopen 전에는 이 로직이 DocumentPrintPanel `allValues` 메모
 *   (=미리보기 경로)에만 인라인 존재했고, 실제 현장 인쇄 경로인 **일괄 출력(handleBatchPrint)**의
 *   `valuesFor`(→ autoValues 바인딩)에는 미배선이었다. 그 결과 미리보기엔 가산·체크가 보이나
 *   현장 인쇄물엔 미반영(preview OK / print FAIL) → 총괄 신고. 순수함수(detectSurchargeKind 등)는
 *   일요일(dow===0)을 이미 공휴일로 판정하므로 요일판정 누락(가설 a)이 아니라, 렌더 경로 미배선이 RC.
 *   → 미리보기·일괄출력 양측이 이 동일 헬퍼를 호출하도록 일원화(SSOT)해 divergence를 구조적으로 차단.
 *
 * @param base          대상 서류 필드 값 번들. **in-place mutate** — 호출측이 form_key별 복사본을
 *                      넘겨 bill_receipt_new ↔ bill_detail 간 공유키(subtotal/total_amount) 교차오염을 차단한다.
 * @param formKey       'bill_receipt_new' | 'bill_detail' 만 적용, 그 외는 no-op(회귀0, AC-5).
 * @param isCalHoliday  clinic_events(event_type='holiday') 달력 빨간날 소스 합집합 판정.
 * @param overriddenKeys 스태프 수동 편집 키(AC-4) — 해당 키는 가산 folding 제외(수동값 우선).
 * @param refDate       판정 기준 일시(출력 시점 = new Date()). 테스트는 특정 일시 주입 가능.
 */
export function applyNightHolidaySurcharge(
  base: Record<string, string>,
  formKey: string,
  isCalHoliday: boolean,
  overriddenKeys: Set<string>,
  refDate: Date,
  buildDetailRow: (args: {
    kind: SurchargeKind;
    amount: number;
    copay: number;
    covered: number;
    date?: string;
  }) => string,
): void {
  if (formKey !== 'bill_receipt_new' && formKey !== 'bill_detail') return;
  const kind = detectSurchargeKind(refDate, isCalHoliday);

  // 체크박스 자동 체크(계산서 신양식). 미가산 시 공란 유지(회귀0, AC-1).
  base.night_mark = surchargeMark(kind, 'night');
  base.holiday_mark = surchargeMark(kind, 'holiday');

  if (formKey === 'bill_receipt_new') {
    // 진찰료 급여 base = 본인부담금(①) + 공단부담금(②). foot 급여 = 진찰료(Q4).
    const copayBase = parseAmt(base.copayment);
    const coveredBase = parseAmt(base.insurance_covered);
    const sc = computeSurcharge(copayBase + coveredBase, copayBase, kind);
    base.surcharge_kind_label = kind ? SURCHARGE_KIND_LABEL[kind] : '';
    base.surcharge_amount = sc.amount > 0 ? formatAmount(sc.amount) : '';
    if (sc.amount > 0) {
      const fold = (key: string, add: number) => {
        if (overriddenKeys.has(key)) return;
        base[key] = formatAmount(parseAmt(base[key]) + add);
      };
      fold('copayment', sc.copay);
      fold('insurance_covered', sc.covered);
      fold('total_amount', sc.amount);
      fold('subtotal_amount', sc.amount);
      // ⑧ 환자부담 총액 = 본인부담 + 비급여(공단 제외) → 가산 본인분만 가산.
      fold('patient_amount', sc.copay);
    }
  } else {
    // bill_detail(세부산정내역): 진찰료 급여 base = 표시된 본인부담금 총계 + 공단부담금 총계.
    const copayBase = parseAmt(base.subtotal_copayment);
    const coveredBase = parseAmt(base.subtotal_fund);
    const sc = computeSurcharge(copayBase + coveredBase, copayBase, kind);
    base.surcharge_kind_label = kind ? SURCHARGE_KIND_LABEL[kind] : '';
    base.surcharge_amount = sc.amount > 0 ? formatAmount(sc.amount) : '';
    if (sc.amount > 0) {
      // 항목 테이블에 가산 급여 행 append(items_html) + 요약행 금액 bump.
      const rowHtml = buildDetailRow({
        kind: kind as SurchargeKind,
        amount: sc.amount,
        copay: sc.copay,
        covered: sc.covered,
        date: base.visit_date ?? '',
      });
      if (rowHtml) base.items_html = (base.items_html ?? '') + '\n' + rowHtml;
      const bump = (key: string, add: number) => {
        if (overriddenKeys.has(key)) return;
        base[key] = formatAmount(parseAmt(base[key]) + add);
      };
      bump('subtotal_copayment', sc.copay);
      bump('total_copayment', sc.copay);
      bump('subtotal_fund', sc.covered);
      bump('total_fund', sc.covered);
      bump('subtotal_amount', sc.amount);
      bump('total_amount', sc.amount);
      // 합계(총액 열) = 본인부담금 + 비급여(공단 제외, GONGDAN-HIDE-COPAY-ONLY B안) → 가산 본인분만.
      bump('detail_subtotal', sc.copay);
      bump('detail_total', sc.copay);
    }
  }
}
