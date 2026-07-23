import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  detectSurchargeKind,
  isNightOrHoliday,
  computeSurcharge,
  surchargeMark,
  toLocalDateStr,
  SURCHARGE_RATE,
  KOREAN_HOLIDAYS_2026,
  applyNightHolidaySurcharge,
  resolveSurchargeRefDate,
} from '../../src/lib/nightHolidaySurcharge';
import { buildSurchargeDetailRowHtml } from '../../src/lib/htmlFormTemplates';

/**
 * E2E — T-20260717-foot-DOCPRINT-NIGHTHOLIDAY-SURCHARGE-AUTOCALC
 * 서류 출력 시 공휴일·야간 가산 자동 판정 + 30% 가산 금액 자동 계산·반영 (B안, FE-only).
 *
 * body 도수센터 canon 포트(REUSE). 금액 assert 필수 — 정상/야간/공휴일 3케이스 + override(AC-4).
 * 순수 함수(detectSurchargeKind/computeSurcharge) 직접 import 로 결정론적 금액 검증.
 */

// 특정 요일·시각의 로컬 Date 생성 헬퍼 (월은 0-index).
const at = (y: number, m: number, d: number, hh: number, mm = 0) => new Date(y, m - 1, d, hh, mm);

test.describe('AC-1/AC-3 — 출력시점 야간·공휴일 자동 판정 (겹침=공휴일 우선 단일)', () => {
  test('시나리오1 정상: 평일 주간 → 가산 없음(null), 체크박스 공란', () => {
    // 2026-07-13(월) 14:00 — 평일 주간, 공휴일 아님
    const ref = at(2026, 7, 13, 14);
    expect(detectSurchargeKind(ref, false)).toBeNull();
    expect(isNightOrHoliday(ref, false)).toBe(false);
    expect(surchargeMark(null, 'night')).toBe(' ');
    expect(surchargeMark(null, 'holiday')).toBe(' ');
  });

  test('시나리오2 야간: 평일 19시 → night, 야간 박스만 체크', () => {
    const ref = at(2026, 7, 13, 19);
    const kind = detectSurchargeKind(ref, false);
    expect(kind).toBe('night');
    expect(surchargeMark(kind, 'night')).toBe('■');
    expect(surchargeMark(kind, 'holiday')).toBe(' ');
  });

  test('18시 경계: 정확히 18:00 은 야간, 17:59 는 아님', () => {
    expect(detectSurchargeKind(at(2026, 7, 13, 18, 0), false)).toBe('night');
    expect(detectSurchargeKind(at(2026, 7, 13, 17, 59), false)).toBeNull();
  });

  test('시나리오3 공휴일 겹침: 법정공휴일 야간 → holiday 단일(야간 미적용)', () => {
    // 2026-01-01(신정) 19:00 — 공휴일+야간 동시 → 공휴일 우선 단일
    const ref = at(2026, 1, 1, 19);
    const kind = detectSurchargeKind(ref, false);
    expect(kind).toBe('holiday');
    expect(surchargeMark(kind, 'holiday')).toBe('■');
    expect(surchargeMark(kind, 'night')).toBe(' '); // 이중 가산 차단
  });

  test('일요일 종일 → holiday', () => {
    // 2026-07-19(일) 10:00
    expect(detectSurchargeKind(at(2026, 7, 19, 10), false)).toBe('holiday');
  });

  // ── addendum 2026-07-19 (MSG-20260719-154002) 신규 요건 2:
  //    일요일(dayOfWeek===0) 공휴일 가산 케이스 명시 assert.
  //    RC 고정: 정부 공공 API(KOREAN_HOLIDAYS_2026)=법정공휴일만 반환·일요일 미포함.
  //    ∴ 공휴일 판정 = (공공 API 공휴일) OR (일요일 dow===0). 일요일 분기(dow===0)가
  //    빠지면 공공목록 밖 일요일이 가산 누락 → 총괄 field-soak FAIL 재현. 이 assert 가 회귀가드.
  test('★일요일 요일판정(dow===0): 공공 API 목록 밖이어도 holiday — (API ∪ 일요일)', () => {
    const sunday = at(2026, 7, 19, 15, 23); // 총괄 신고 시점(2026-07-19 일요일 오후)
    // (1) 정부 공공 API 목록에는 일요일이 없음 — API 단독으론 가산 판정 불가
    expect(KOREAN_HOLIDAYS_2026.has('2026-07-19')).toBe(false);
    expect(sunday.getDay()).toBe(0); // dow===0 = 일요일
    // (2) 그럼에도 dow===0 분기로 holiday 판정 (시간대·API 무관 전일)
    expect(detectSurchargeKind(sunday, false)).toBe('holiday');
    expect(isNightOrHoliday(sunday, false)).toBe(true);
    // (3) 겹침규칙: 일요일 야간(19시)도 holiday 단일(야간 미적용, 이중가산 차단)
    expect(detectSurchargeKind(at(2026, 7, 19, 19), false)).toBe('holiday');
    expect(surchargeMark(detectSurchargeKind(sunday, false), 'holiday')).toBe('■');
    expect(surchargeMark(detectSurchargeKind(sunday, false), 'night')).toBe(' ');
  });

  // ── canon 갱신 2026-07-23 (T-20260723-foot-SATURDAY-SURCHARGE-CANON-IMPL) ──
  //    ⚠ 구 canon 폐기: 토요일은 더 이상 '평일 야간 규칙'을 따르지 않는다.
  //    신규 canon(총괄 확정): 토요일(dow===6)은 09시부터 종일 공휴일과 동일 30% 가산 → 'holiday'.
  //    오전 09~13시도 가산(13시 기준 아님). 토요일 야간(18시~) 겹침도 holiday 단일(canon #4).
  //    상세 신규 assert 는 별도 spec(T-20260723-...) 참조. 여기선 AUTOCALC 회귀가드로 최소 재검.
  test('★토요일 canon 갱신(dow===6): 09시부터 종일 holiday(구 night 규칙 폐기)', () => {
    const satNoon = at(2026, 7, 18, 14); // 2026-07-18(토) 14:00
    const satNight = at(2026, 7, 18, 19); // 2026-07-18(토) 19:00
    expect(satNoon.getDay()).toBe(6); // dow===6 = 토요일
    expect(KOREAN_HOLIDAYS_2026.has('2026-07-18')).toBe(false); // 법정공휴일 아님 — 요일(토) 판정만으로 holiday
    // 토요일 주간(오전 09~13시 포함) → holiday (구 canon 의 null 폐기)
    expect(detectSurchargeKind(satNoon, false)).toBe('holiday');
    expect(surchargeMark(detectSurchargeKind(satNoon, false), 'holiday')).toBe('■');
    expect(surchargeMark(detectSurchargeKind(satNoon, false), 'night')).toBe(' '); // 야간 미적용(단일)
    // 토요일 야간(18시~) 겹침 → holiday 단일 (구 canon 의 night 폐기, canon #4)
    expect(detectSurchargeKind(satNight, false)).toBe('holiday');
    expect(surchargeMark(detectSurchargeKind(satNight, false), 'night')).toBe(' ');
  });

  test('달력 빨간날(clinic_events) 소스: 법정목록 밖이어도 공휴일 인식 — 제헌절 2026-07-17', () => {
    // 2026-07-17(금)은 KOREAN_HOLIDAYS_2026 목록 밖이나 isCalendarHoliday=true → holiday
    expect(KOREAN_HOLIDAYS_2026.has('2026-07-17')).toBe(false);
    expect(detectSurchargeKind(at(2026, 7, 17, 14), true)).toBe('holiday');
    // 달력 소스 없으면 평일 주간 → 가산 없음(회귀 방지)
    expect(detectSurchargeKind(at(2026, 7, 17, 14), false)).toBeNull();
  });
});

// ── 2026-07-19 (MSG-20260719-160435-exfb) 포트 갭 close: 판정 기준일 = 진료일(checked_in_at) ──
//    body canon(visitDate=checked_in_at) 미러. print-time(new Date())이 아니라 진료 당시 일시로 판정 →
//    일요일 진료분을 다음날(월요일)에 출력해도 공휴일 가산 유지(과거·미래 진료일 정확, dev-body 회신 정합).
test.describe('AC-4 canon — 판정 기준일 = 진료일(checked_in_at) (resolveSurchargeRefDate)', () => {
  test('checked_in_at 우선: 일요일 진료 → 월요일 출력(now)이어도 진료 당시(일요일) 기준 holiday', () => {
    const printedOnMonday = at(2026, 7, 20, 11); // 출력 시점 = 월요일 주간(그 자체론 가산 없음)
    // 진료는 전날 일요일 15:23(checked_in_at)에 이뤄짐
    const ref = resolveSurchargeRefDate('2026-07-19T15:23:00+09:00', printedOnMonday);
    expect(ref.getDay()).toBe(0); // 진료일=일요일 (출력일 월요일 아님)
    expect(detectSurchargeKind(ref, false)).toBe('holiday'); // 진료 당시 기준 공휴일 가산 유지
    // 대조: print-time(월요일) 기준이면 가산 누락됐을 것 — 포트 갭 회귀가드
    expect(detectSurchargeKind(printedOnMonday, false)).toBeNull();
  });

  test('checked_in_at 야간(평일 19시) → 다음날 주간 출력이어도 night 유지', () => {
    const printedNextDay = at(2026, 7, 14, 10); // 화 주간
    const ref = resolveSurchargeRefDate('2026-07-13T19:30:00+09:00', printedNextDay); // 월 19:30 진료
    expect(detectSurchargeKind(ref, false)).toBe('night');
  });

  test('checked_in_at 부재/파싱불가 → now 폴백(워크인 미체크인)', () => {
    const now = at(2026, 7, 19, 15, 23); // 일요일
    expect(resolveSurchargeRefDate(null, now)).toBe(now);
    expect(resolveSurchargeRefDate('', now)).toBe(now);
    expect(resolveSurchargeRefDate('not-a-date', now)).toBe(now);
    // 폴백 now 가 일요일이면 그대로 holiday 판정
    expect(detectSurchargeKind(resolveSurchargeRefDate(null, now), false)).toBe('holiday');
  });
});

test.describe('AC-2 — 확정 요율 30% 가산 금액 자동 계산 + 급여 본인/공단 비례 분할', () => {
  test('요율 상수 = 0.30', () => {
    expect(SURCHARGE_RATE).toBe(0.3);
  });

  test('진찰료 급여 10,000(본인 3,000/공단 7,000) × 30% = 3,000 (본인 900/공단 2,100)', () => {
    const sc = computeSurcharge(10000, 3000, 'holiday');
    expect(sc.amount).toBe(3000);
    expect(sc.copay).toBe(900); // round(3000 × 3000/10000)
    expect(sc.covered).toBe(2100); // amount - copay
    expect(sc.copay + sc.covered).toBe(sc.amount); // 분할 합 = 총액(누락·이중 없음)
  });

  test('야간도 동일 30% 적용', () => {
    expect(computeSurcharge(20000, 6000, 'night').amount).toBe(6000);
  });

  test('AC-5 회귀: 가산 없음(null) → 전부 0, 기본금액 불변', () => {
    const sc = computeSurcharge(10000, 3000, null);
    expect(sc.amount).toBe(0);
    expect(sc.copay).toBe(0);
    expect(sc.covered).toBe(0);
  });

  test('base 0 → 0 (0 나눗셈·음수 방지)', () => {
    const sc = computeSurcharge(0, 0, 'holiday');
    expect(sc.amount).toBe(0);
    expect(sc.copay).toBe(0);
  });
});

test.describe('세부산정내역 가산 행 — 12컬럼 정합 + 금액 반영', () => {
  test('holiday 가산 행: 명칭/코드/금액/본인/공단 렌더', () => {
    const html = buildSurchargeDetailRowHtml({ kind: 'holiday', amount: 3000, copay: 900, covered: 2100, date: '2026-01-01' });
    expect(html).toContain('공휴일 진료 가산 (30%)');
    expect(html).toContain('050'); // 공휴일 코드 suffix canon
    expect(html).toContain('3,000');
    expect(html).toContain('900');
    expect(html).toContain('2,100');
    // 12컬럼 유지(td 12개)
    expect((html.match(/<td/g) ?? []).length).toBe(12);
  });

  test('night 가산 행: 코드 010', () => {
    const html = buildSurchargeDetailRowHtml({ kind: 'night', amount: 6000, copay: 1800, covered: 4200, date: '2026-07-13' });
    expect(html).toContain('야간 진료 가산 (30%)');
    expect(html).toContain('010');
  });

  test('amount 0 → 빈 행(가산 미적용 회귀)', () => {
    expect(buildSurchargeDetailRowHtml({ kind: 'night', amount: 0, copay: 0, covered: 0 })).toBe('');
  });
});

/**
 * ── reopen 2026-07-19 (field-soak FAIL RC) — 실 값 번들 augmentation 검증 ──
 * 기존 spec은 순수함수 직접호출 + 소스 문자열 grep만 했다(렌더 경로 미검증) → 가산이 미리보기(allValues)에만
 * 반영되고 현장 인쇄 경로(handleBatchPrint valuesFor)엔 미배선인 divergence를 잡지 못하고 GO가 나갔다.
 * RC 재발 방지: 출력에 실제 바인딩되는 **값 번들**을 SSOT 헬퍼(applyNightHolidaySurcharge)로 변형해
 * 일요일(2026-07-19) 공휴일 체크·금액 반영을 직접 assert 한다(총괄 신고 케이스 재현).
 */
test.describe('AC-1/2/3/4/5 — applyNightHolidaySurcharge 값 번들 변형 (일요일 공휴일 재현)', () => {
  const at = (y: number, m: number, d: number, hh: number, mm = 0) => new Date(y, m - 1, d, hh, mm);
  const sunday = at(2026, 7, 19, 15, 23); // 총괄 신고 시점(일요일 오후) 재현
  const weekdayNoon = at(2026, 7, 13, 14); // 평일 주간(가산 없음)

  test('bill_receipt_new 일요일: 공휴일 박스 체크(■)+진찰료 30% 가산 금액란 반영(AC-1/2)', () => {
    const base: Record<string, string> = {
      copayment: '3,000',
      insurance_covered: '7,000',
      total_amount: '10,000',
      subtotal_amount: '10,000',
      patient_amount: '3,000',
    };
    applyNightHolidaySurcharge(base, 'bill_receipt_new', false, new Set(), sunday, buildSurchargeDetailRowHtml);
    // 체크박스: 공휴일만 체크(일요일=공휴일 우선 단일, 야간 미적용 AC-3)
    expect(base.holiday_mark).toBe('■');
    expect(base.night_mark).toBe(' ');
    expect(base.surcharge_kind_label).toBe('공휴일');
    // 진찰료 급여 10,000 × 30% = 3,000 (본인 900 / 공단 2,100)
    expect(base.surcharge_amount).toBe('3,000');
    expect(base.copayment).toBe('3,900');          // 3,000 + 900
    expect(base.insurance_covered).toBe('9,100');   // 7,000 + 2,100
    expect(base.total_amount).toBe('13,000');       // 10,000 + 3,000
    expect(base.subtotal_amount).toBe('13,000');
    expect(base.patient_amount).toBe('3,900');      // 본인부담 + 가산 본인분
  });

  test('bill_receipt_new 평일 주간: 가산 없음·금액 불변·체크 공란(AC-5 회귀)', () => {
    const base: Record<string, string> = {
      copayment: '3,000', insurance_covered: '7,000', total_amount: '10,000',
      subtotal_amount: '10,000', patient_amount: '3,000',
    };
    applyNightHolidaySurcharge(base, 'bill_receipt_new', false, new Set(), weekdayNoon, buildSurchargeDetailRowHtml);
    expect(base.holiday_mark).toBe(' ');
    expect(base.night_mark).toBe(' ');
    expect(base.surcharge_amount).toBe('');
    expect(base.copayment).toBe('3,000');       // 불변
    expect(base.total_amount).toBe('10,000');   // 불변
  });

  test('AC-4 override: 수동 편집된 키(copayment)는 가산 folding 제외', () => {
    const base: Record<string, string> = {
      copayment: '5,000', insurance_covered: '7,000', total_amount: '12,000',
      subtotal_amount: '12,000', patient_amount: '5,000',
    };
    applyNightHolidaySurcharge(base, 'bill_receipt_new', false, new Set(['copayment']), sunday, buildSurchargeDetailRowHtml);
    // 진찰료 급여 12,000 × 30% = 3,600. copayment 는 수동값 그대로(override 우선), 나머지는 가산 반영.
    expect(base.copayment).toBe('5,000');
    expect(base.total_amount).toBe('15,600'); // 12,000 + 3,600 (override 아닌 키는 folding)
  });

  test('bill_detail 일요일: 세부산정내역 가산 행 append + 요약 금액 bump', () => {
    const base: Record<string, string> = {
      subtotal_copayment: '3,000', subtotal_fund: '7,000',
      total_copayment: '3,000', total_fund: '7,000',
      subtotal_amount: '10,000', total_amount: '10,000',
      detail_subtotal: '3,000', detail_total: '3,000',
      items_html: '<tr><td>기존행</td></tr>', visit_date: '2026-07-19',
    };
    applyNightHolidaySurcharge(base, 'bill_detail', false, new Set(), sunday, buildSurchargeDetailRowHtml);
    expect(base.holiday_mark).toBe('■');
    expect(base.items_html).toContain('공휴일 진료 가산 (30%)'); // 가산 행 실제 append
    expect(base.items_html).toContain('기존행');                 // 기존 항목 보존
    expect(base.subtotal_copayment).toBe('3,900');
    expect(base.total_amount).toBe('13,000');
  });

  test('대상 외 form_key(rx_standard)는 no-op(회귀0)', () => {
    const base: Record<string, string> = { copayment: '3,000', total_amount: '10,000' };
    applyNightHolidaySurcharge(base, 'rx_standard', false, new Set(), sunday, buildSurchargeDetailRowHtml);
    expect(base.total_amount).toBe('10,000'); // 불변
    expect(base.night_mark).toBeUndefined();  // 마크 미설정
  });
});

test.describe('AC-1 — 계산서 신양식 토큰 + 양 출력경로(미리보기·일괄출력) SSOT 배선 회귀가드', () => {
  const panelSrc = () => readFileSync('src/components/DocumentPrintPanel.tsx', 'utf-8');
  const tmplSrc = () => readFileSync('src/lib/htmlFormTemplates.ts', 'utf-8');

  test('bill_receipt_new 야간(공휴일) 박스가 night_mark/holiday_mark 토큰으로 배선', () => {
    expect(tmplSrc()).toContain('[{{night_mark}}]야간 [{{holiday_mark}}]공휴일');
  });

  test('RC 가드: 미리보기(allValues)와 일괄출력(handleBatchPrint) 양쪽이 SSOT 헬퍼 호출', () => {
    const src = panelSrc();
    // 헬퍼 호출이 최소 2곳(allValues memo + valuesFor) — divergence 재발 방지
    const calls = src.match(/applyNightHolidaySurcharge\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    // 일괄출력 경로가 form_key별 복사본에 적용(공유 autoValues 원본 무변경)
    expect(src).toContain('const v = { ...(perTemplateValues.get(t.id) ?? autoValues) };');
    expect(src).toContain('applyNightHolidaySurcharge(');
  });

  test('포트 갭 가드(exfb): 양 경로가 진료일(checked_in_at) 기준 refDate 사용 — print-time 미사용', () => {
    const src = panelSrc();
    // 미리보기·일괄출력 양측이 resolveSurchargeRefDate(checkIn.checked_in_at, ...)로 판정일 도출
    const resolveCalls = src.match(/resolveSurchargeRefDate\(checkIn\.checked_in_at,/g) ?? [];
    expect(resolveCalls.length).toBeGreaterThanOrEqual(2);
    // clinic_events 달력 판정도 refDate(진료일) 기준 — toLocalDateStr(new Date()) 직접 사용 회귀 차단
    expect(src).not.toContain('holidayDateSet.has(toLocalDateStr(new Date()))');
  });

  test('AC-6 ★가드: FE-only — service_charges 영속 없음(auto_calc origin 미기입)', () => {
    expect(panelSrc()).not.toContain("origin: 'auto_calc'");
  });
});
