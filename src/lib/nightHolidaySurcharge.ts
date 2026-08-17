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
 *   ★ 미러 범위 한정(오경보 방지, MSG-20260801 dev-body 교차점검): body 미러는 위 **판정 4파라미터에 한정**한다.
 *     절사 grain(floor10)은 body 미러 대상이 아니다 — foot 고유 canon(footBilling CIT-2026-001/002 FLOOR,
 *     T-20260728 foot 단독 추가)이 소유하며 각 도메인 billing canon 이 독립 소유한다. body 가산 단일지점은
 *     Math.round(1원 grain)이라 foot floor10 과 grain 자체가 다르다. '절사까지 body 미러'로 읽지 말 것.
 *
 * body(persist 경로: service_charges origin='auto_calc' + surcharge_kind)와 달리 foot 은
 * **DB 무접촉 FE-only(db_change=false)** — 출력 시점(new Date())에 판정·계산해 금액란에 표시만 한다.
 * 급여 본인부담 분자 이중계상 없음(★가드): 가산은 print 표시 전용이라 Revenue Insurance Split
 * 집계(service_charges)에 영속되지 않으므로 매출 분자에 진입하지 않음(AC-6 구조적 충족).
 */

import { formatAmount } from '@/lib/format';
// T-20260805-foot-COPAY-TRUNCATE-FUND-TRANSFER-MISSING (item #8): 세부산정내역서 본인부담 floor100 끝수 → 공단 이전.
//   floorOutpatientCopayment(외래 100원 FLOOR) + computeBillDetailRounding(문서 floor10 단일 authority, 재발명 금지)
//   재사용. footBilling → nightHolidaySurcharge 역참조 없음(단방향, 순환 import 무).
import { floorOutpatientCopayment, computeBillDetailRounding } from '@/lib/footBilling';

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
 *
 * ── T-20260817-foot-HOLIDAY-SURCHARGE-SUBSTITUTE-CENSUS (2026-08-17, body P0 자매 census) ──
 *   body(도수) CRM에서 2026 대체공휴일 누락으로 공휴일 가산 자동선택 미발동(P0). foot 동일 목록 census
 *   결과 대체공휴일 3일 누락 확인 → 2026 관보 확정치 대조 후 추가.
 *   공식 2026 대체공휴일 = 4일(전부 월요일): 3/2(삼일절 3/1 일요일 대체) · 5/25(부처님오신날 5/24
 *   일요일 대체·아래 기존 항목이 곧 이 대체일) · 8/17(광복절 8/15 토요일 대체) · 10/5(개천절 10/3
 *   토요일 대체). ★2026-06-08 은 대체공휴일 아님 — 현충일(6/6 토)은 대체공휴일 비대상(관보 대조로
 *   확정, 추가 금지: 정상 근무 월요일에 가산 오적용→초과징수 방지). body 목록과 값 동기화(AC-5).
 *
 * ── T-20260817-foot-HOLIDAY-SEOLLAL-2026-WRONGYEAR-DATES (2026-08-17, census 부수발견 정정) ──
 *   설날 항목이 2025 설날(2026-01-28~30)로 오복사되어 있던 것을 2026 관보 확정치로 정정.
 *   2026 설날 = 2/17(당일·화), 연휴 2/16(전날·월)~2/18(다음날·수) — 3일 전부 평일, 대체공휴일 없음.
 *   구값(1/28~30)은 2025 설날 연휴 → 2026 해당일은 평일(가산 미발동)이라 실제 설날(2/16~18)에 공휴일
 *   가산 자동선택 누락(과소청구) + 무관한 1월 평일 검증 시 오적용 위험. body 자매 SEOLLAL 티켓과 값 동기화.
 *   출처 = 우주항공청 「2026년 월력요항」 / 정부 공공 국가공휴일 목록(2026 관보 재대조).
 */
export const KOREAN_HOLIDAYS_2026 = new Set<string>([
  '2026-01-01', // 신정
  '2026-02-16', // 설날 전날(월) — T-20260817 SEOLLAL 정정: 구 2026-01-28(2025 설날) 오복사 제거
  '2026-02-17', // 설날(화) — 2026 관보 확정, 구 2026-01-29 대체
  '2026-02-18', // 설날 다음날(수) — 구 2026-01-30 대체 (2/16~18 전부 평일, 대체공휴일 없음)
  '2026-03-01', // 삼일절
  '2026-03-02', // 삼일절 대체공휴일(3/1 일요일) — T-20260817 census 추가
  '2026-05-05', // 어린이날
  '2026-05-25', // 부처님오신날 대체공휴일(5/24 일요일) — 대체일 자체(원 공휴일 5/24는 일요일 종일 판정으로 커버)
  '2026-06-06', // 현충일 (토요일 — 대체공휴일 비대상, 6/8 추가 금지)
  '2026-08-15', // 광복절
  '2026-08-17', // 광복절 대체공휴일(8/15 토요일) — T-20260817 census 추가
  '2026-09-30', // 추석 전날
  '2026-10-01', // 추석
  '2026-10-02', // 추석 다음날
  '2026-10-03', // 개천절
  '2026-10-05', // 개천절 대체공휴일(10/3 토요일) — T-20260817 census 추가
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
 * ── T-20260717-foot-DOCPRINT-NIGHTHOLIDAY-SURCHARGE-AUTOCALC (2026-07-19 body-canon 포트 갭 close, MSG-20260719-160435-exfb) ──
 * 가산 판정 기준 일시 결정 = **진료일(checked_in_at)** — 출력 시점(now)이 아니라 실제 진료가 이뤄진
 * 일시로 판정한다. body Chart2InsuranceCalcPanel 의 visitDate=checked_in_at canon 동일(AC-4 canon).
 * 과거·미래 진료일 서류를 나중에(예: 다음날) 출력해도 진료 당시의 요일(일요일 dow===0)·공휴일·야간(18시
 * 이후)이 정확히 반영된다. print-time(new Date()) 기준이면 일요일 진료분을 월요일에 출력 시 가산 누락.
 * checked_in_at 부재(워크인 미체크인) 시에만 now 로 폴백(기존 visitDate 문자열 폴백 규칙과 동일).
 * @param checkedInAt 체크인 일시(ISO 문자열). null/빈값/파싱불가면 now 폴백.
 * @param now 폴백용 출력 시점(테스트는 특정 일시 주입 가능).
 */
export function resolveSurchargeRefDate(checkedInAt: string | null | undefined, now: Date): Date {
  if (!checkedInAt) return now;
  const d = new Date(checkedInAt);
  return Number.isNaN(d.getTime()) ? now : d;
}

/**
 * 야간·공휴일 가산 대상 여부 (body canon isNightOrHoliday 동일).
 * - 일요일 종일 / 공휴일 종일(법정목록 ∪ 달력 빨간날) / 토요일 09시부터 종일 / 평일 18시 이후.
 *
 * ── T-20260723-foot-SATURDAY-SURCHARGE-CANON-IMPL (총괄 확정 canon) ──
 *   토요일(dow===6)은 의원급 기준 09시부터 종일 공휴일과 동일한 30% 가산(13시 기준 아님, 오전 09~13시도 가산).
 *   별도 토요일 분기값 신설 없이 기존 '공휴일'(holiday) 경로를 그대로 재사용(표기='공휴일' 체크).
 *   토요일 야간(18시~) 겹침 → 공휴일 단일(기존 canon T-20260706, detectSurchargeKind가 holiday 우선 반환).
 *   ⚠ cross-repo co-change: body 동일 canon(pair 티켓)과 동시 변경·동시 배포. 한쪽만 배포 금지.
 * @param refDate 판정 기준 일시(출력 시점 = new Date()).
 * @param isCalendarHoliday clinic_events(event_type='holiday') 달력 빨간날 소스 판정 결과.
 */
export function isNightOrHoliday(refDate: Date, isCalendarHoliday = false): boolean {
  const dow = refDate.getDay(); // 0=Sun, 6=Sat
  const hour = refDate.getHours();
  const dateStr = toLocalDateStr(refDate);

  if (dow === 0) return true; // 일요일 종일
  if (KOREAN_HOLIDAYS_2026.has(dateStr) || isCalendarHoliday) return true; // 공휴일 종일
  if (dow === 6 && hour >= 9) return true; // 토요일 09시부터 종일 (공휴일 canon 동일)
  if (hour >= 18) return true; // 18시 이후 (평일 야간)
  return false;
}

/**
 * 적용 가산 종류 단일 판별 (body canon detectSurchargeKind 동일).
 * 야간+공휴일 동시 성립 시 **공휴일 우선 단일 가산**(합산 X, 겹침규칙 canon 동일):
 *   - 공휴일(법정공휴일 ∪ 일요일 ∪ 달력 빨간날 ∪ 토요일 09시~) → 'holiday' (전일 또는 09시부터 종일).
 *   - 공휴일 아니고 평일 18시 이후 → 'night'.
 *   - 그 외 → null(가산 없음).
 * 반환은 항상 단일 → 이중 가산(합산) 구조적 차단(AC-3).
 *
 * ── T-20260723-foot-SATURDAY-SURCHARGE-CANON-IMPL (총괄 확정 canon, 재정의 금지) ──
 *   토요일(dow===6)은 09시부터 종일 공휴일과 동일 취급 → 기존 'holiday' 경로 재사용(가산율 30% / +050 /
 *   "(공휴일)" 명칭 그대로, 신규 발명 금지). 오전 09~13시도 가산(13시 기준 아님). 토요일 야간(18시~) 겹침도
 *   holiday 우선 반환으로 공휴일 단일(기존 T-20260706 canon). 토요일 09시 이전은 미개원 → null(회귀0).
 *   ⚠ cross-repo co-change: body 동일 canon(pair 티켓)과 로직 diff 일치 필수, 동시 배포.
 */
export function detectSurchargeKind(refDate: Date, isCalendarHoliday = false): SurchargeKind | null {
  const dow = refDate.getDay(); // 0=Sun, 6=Sat
  const hour = refDate.getHours();
  const dateStr = toLocalDateStr(refDate);

  // 공휴일 종일 우선 (법정공휴일 ∪ 일요일 ∪ 달력 빨간날 ∪ 토요일 09시~) — 겹쳐도 공휴일 단일 적용
  if (dow === 0 || KOREAN_HOLIDAYS_2026.has(dateStr) || isCalendarHoliday || (dow === 6 && hour >= 9)) return 'holiday';
  // 평일 18시 이후 → 야간
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
 * @returns amount=가산 총액, copay=가산 본인부담분, covered=가산 공단부담분. **셋 다 10원 배수**(단일 절사 지점).
 *
 * ── T-20260728-foot-NIGHTHOLIDAY-SURCHARGE-FLOOR10-NOTAPPLIED (P0 hotfix, v4 — copay revert 420/980) ──
 *   가산 산출값은 **10원 미만 절사(FLOOR)** — 국민건강보험법 시행령 별표2 제1항(요양급여비용총액 10원 미만 절사) 정합.
 *   종전 Math.round(반올림)은 5원 이상에서 절상(초과징수)되어 요양급여비용총액이 10원 배수를 벗어났다:
 *     18,840 × 0.3 = 5,652 → (round) 5,652 → 총액 24,492 [X] / (floor10) 5,650 → 총액 24,490 [O]
 *   CEIL·ROUND 복귀 금지(footBilling.ts CIT-2026-001/002 FLOOR canon 동일 계열). 절사는 항상 하향(초과징수 방지).
 *
 *   ★ v4 정정(FIX-REQUEST v4, 이은상 팀장 필드권위 긴급정정, MSG-20260801-122530-ecjt / 122918-vtuh):
 *     - 1차(13ff260b)는 amount 만 floor10, copay=round(amount×ratio) → copay·covered 원단위 잔존(418/982).
 *     - v3(f3bc8974)는 copay=floor10(amount×ratio)=410 산출 → **공단 과대계상(NHIS 과대청구) + double-rounding
 *       위반**(절사된 amount 를 ratio 로 재분할 = footBilling.ts:822 금지 경계). 법정증빙 컴플라이언스 위반으로 폐기.
 *     - v4(canon): copay 를 **진찰료 본인부담 base×RATE 직접 floor10** 으로 산출(원 base 기준, amount 재분할 금지).
 *       covered = amount − copay 로 잔차 흡수 → copay+covered == amount 불변식 구조적 보장.
 *         amount  = floor10(base×RATE)                 → floor10(4,693×0.3)=1,400
 *         copay   = floor10(copayment×RATE)            → floor10(1,400×0.3)=420  (v3 의 410 아님)
 *         covered = amount − copay                     → 980  (= floor10(3,293×0.3))
 *       필드 TARGET(420/980)이 formula 보다 우선(§13.1.A reporter-explicit, 이은상 팀장 F-4741 독립검산).
 *   이 함수가 4종 서류(세부산정내역/영수증 신·구/보험청구서) 공유 SSOT(applyNightHolidaySurcharge)의 유일 산출점 →
 *     여기서 전부 10원 배수로 확정하면 가산 행 표시값·계 행 fold 값이 동일 절사면에 정렬되어 계 행 == 행별 합(AC-6).
 *   double-rounding 경계(footBilling.ts:822) 준수 — 가산 절사가 본인부담 aggregate floor100(=1,800) 에 무영향.
 */
export function computeSurcharge(
  base: number,
  copayment: number,
  kind: SurchargeKind | null,
): { amount: number; copay: number; covered: number } {
  if (!kind || base <= 0) return { amount: 0, copay: 0, covered: 0 };
  // 10원 미만 절사(FLOOR) — 별표2 제1항. round(초과징수)→floor 정정. CEIL/ROUND 복귀 금지.
  // 단일 절사 지점: amount·copay 각각 floor10, covered=amount−copay 로 잔차 흡수 → 세 값 모두 10원 배수.
  const amount = Math.floor((base * SURCHARGE_RATE) / 10) * 10;
  // v4(copay-revert): copay 는 **진찰료 본인부담 base×RATE 를 직접 floor10** — 절사된 amount 를 ratio 로 재분할하는
  //   double-rounding(footBilling.ts:822 금지 경계) 을 피한다. 절사된 amount×ratio 재계산 시 공단 과대계상(410) 발생.
  const rawCopay = copayment > 0 ? Math.min(copayment, base) * SURCHARGE_RATE : 0;
  const copay = Math.min(amount, Math.floor(rawCopay / 10) * 10); // floor10(본인부담×RATE) → 필드 TARGET 420
  const covered = Math.max(0, amount - copay); // 잔차 흡수 → copay+covered==amount 구조보장, covered 도 10원 배수(980)
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
 * @param consultSurchargeBase ── T-20260725-foot-SURCHARGE-SCOPE-GYUNTEST-EXCLUDE ──
 *   가산 base 를 **진찰료 급여 line-item 만**으로 한정한 값(covered=진찰료 급여 전액, copay=진찰료 본인부담).
 *   주입 시 이 값으로 30% 가산을 산정한다 — 균검사(진단검사료)·기타 검사료·처치료 등 비진찰료 급여가
 *   포함된 aggregate(base.copayment/insurance_covered)로 계산하던 over-application 을 차단한다.
 *   미주입(undefined/null)이면 레거시(aggregate 급여 전체) 폴백 — line-item 정보가 없는 degenerate 경로 전용.
 *   호출부는 footBillingItems 가 있으면 computeConsultationSurchargeBase(호출부 grain opts 동일)로 주입한다.
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
  consultSurchargeBase?: { covered: number; copay: number } | null,
): void {
  if (formKey !== 'bill_receipt_new' && formKey !== 'bill_detail') return;
  const kind = detectSurchargeKind(refDate, isCalHoliday);

  // 체크박스 자동 체크(계산서 신양식). 미가산 시 공란 유지(회귀0, AC-1).
  base.night_mark = surchargeMark(kind, 'night');
  base.holiday_mark = surchargeMark(kind, 'holiday');

  if (formKey === 'bill_receipt_new') {
    // 진찰료 급여 base = 본인부담금(①) + 공단부담금(②). foot 급여 = 진찰료(Q4).
    // 가산 base = 진찰료 급여만(canon). consultSurchargeBase 주입 시 그것으로 한정(균검사 등 제외),
    //   미주입 시 레거시(aggregate 급여 전체) 폴백 — over-application 은 주입 경로에서 차단된다.
    const copayBase = parseAmt(base.copayment);
    const coveredBase = parseAmt(base.insurance_covered);
    const sc = consultSurchargeBase
      ? computeSurcharge(consultSurchargeBase.covered, consultSurchargeBase.copay, kind)
      : computeSurcharge(copayBase + coveredBase, copayBase, kind);
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
    //   consultSurchargeBase 주입 시 진찰료-only 로 한정(균검사 등 제외), 미주입 시 레거시 폴백.
    const copayBase = parseAmt(base.subtotal_copayment);
    const coveredBase = parseAmt(base.subtotal_fund);
    const sc = consultSurchargeBase
      ? computeSurcharge(consultSurchargeBase.covered, consultSurchargeBase.copay, kind)
      : computeSurcharge(copayBase + coveredBase, copayBase, kind);
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
      // 계(절사전, detail_subtotal)에 가산 본인분 반영.
      bump('detail_subtotal', sc.copay);
      // ── T-20260801-foot-BILLDETAIL-SURCHARGE-RECOMPUTE-REGRESSION (P0 roll-forward, 이은상 팀장 확정 2026-08-01) ──
      //   RC: 13ff260b 가 이 분기에 detail_total/detail_rounding 재계산 블록을 추가한 뒤, 서류 렌더 경로
      //     (DocumentPrintPanel: computeBillDetailRounding(payableB) 로 detail_subtotal/rounding/total 산출)와
      //     이중으로 detail_total 을 산출 → 세부내역서 계/합계가 어긋났다(F-4741 김병완, 공휴일 가산 건).
      //   정정: 재계산 블록 제거 + 종전 additive bump 복원. 세부내역서 계/합계 floor10 의 단일 authority 는
      //     서류 렌더 경로의 computeBillDetailRounding(AC-9 SSOT, 무접촉) 하나이며, 여기서는 가산 본인분을
      //     detail_total 에 additive fold 만 한다(§53 no-revert roll-forward).
      bump('detail_total', sc.copay);
    }
    // ── T-20260805-foot-COPAY-TRUNCATE-FUND-TRANSFER-MISSING (item #8, 이은상 팀장 최종확정 s5kh 2026-08-05) ──
    //   세부산정내역서(bill_detail) ①본인부담 floor100 끝수 → ②공단부담 이전(보존식). 영수증 신양식
    //   absorbBillReceiptNewCopayFloorRemainder 와 **동일 연산을 양쪽 열**(subtotal_copayment/subtotal_fund)에 적용해
    //   detail_total(=본인+비급여) == 영수증 ⑧ parity 달성(공단 열 단독 수정 금지 — 본인 floor100 이 detail_total 에도 반영).
    //   ★가산 fold(위 bump) **이후** 실행 → rawCopay = 가산 포함 aggregate. `if(sc.amount>0)` 밖에 두어 무가산 건
    //   (base 본인부담 자체에 끝수, 예: 11,440)도 정합(영수증 absorb 가 가산무관 적용됨과 동일 grain, AC-6 3경로 동일값).
    //   기존 bump 8줄·computeSurcharge v4 canon 무접촉(additive enrich, §53 no-revert). subtotal_amount/total_amount
    //   (진료비 총액, 공단 포함)은 절대 미접촉 → 보존식(본인+공단=총액) AC-1 성립.
    {
      const rawCopay = parseAmt(base.subtotal_copayment);        // 가산 포함, 절사 전
      const fundBase = parseAmt(base.subtotal_fund);             // 공단부담(끝수 이전 前)
      const flooredCopay = floorOutpatientCopayment(rawCopay);   // 외래 100원 FLOOR(급여 본인부담)
      const remainder = rawCopay - flooredCopay;                 // 공단으로 넘길 끝수
      // 무회귀 가드: remainder==0(평일·무가산/이미 100배수) → no-op(AC-5/시나리오2).
      //   subtotal_fund<=0(등급부재·비급여only) → no-op(영수증 absorb 와 동일 가드, AC-7 grade=null 무회귀).
      //   overriddenKeys(스태프 수동 편집) → 수동값 우선(기존 bump 동일 semantics, AC-4).
      const copayOverridden = overriddenKeys.has('subtotal_copayment') || overriddenKeys.has('total_copayment');
      const fundOverridden = overriddenKeys.has('subtotal_fund') || overriddenKeys.has('total_fund');
      if (remainder > 0 && fundBase > 0 && !copayOverridden && !fundOverridden) {
        base.subtotal_copayment = formatAmount(flooredCopay);
        base.total_copayment = base.subtotal_copayment;
        base.subtotal_fund = formatAmount(fundBase + remainder);   // 끝수 공단 흡수(보존식)
        base.total_fund = base.subtotal_fund;
        // 계(detail_subtotal) = 본인(floor後) + 비급여 → remainder 만큼 감소. 합계 = floor10(계)(computeBillDetailRounding
        //   단일 authority), 끝처리조정 = 합계 − 계. 계/합계 동시 갱신 → 상호 정합(F-4741 divergence 재발 방지).
        if (!overriddenKeys.has('detail_subtotal')) {
          const detailSubtotal = Math.max(0, parseAmt(base.detail_subtotal) - remainder);
          const { adjustment, roundedTotal } = computeBillDetailRounding(detailSubtotal);
          base.detail_subtotal = formatAmount(detailSubtotal);
          if (!overriddenKeys.has('detail_total')) base.detail_total = formatAmount(roundedTotal);
          if (!overriddenKeys.has('detail_rounding')) base.detail_rounding = formatAmount(adjustment);
        }
      }
    }
  }
}
