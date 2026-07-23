import { test, expect } from '@playwright/test';
import {
  detectSurchargeKind,
  isNightOrHoliday,
  computeSurcharge,
  surchargeMark,
  applyNightHolidaySurcharge,
  SURCHARGE_RATE,
  KOREAN_HOLIDAYS_2026,
} from '../../src/lib/nightHolidaySurcharge';
import { buildSurchargeDetailRowHtml } from '../../src/lib/htmlFormTemplates';

/**
 * E2E — T-20260723-foot-SATURDAY-SURCHARGE-CANON-IMPL
 * 토요일 전일가산 canon 구현 (총괄 확정, 재정의 금지):
 *   1. 토요일 = 의원급 기준 09시부터 종일 30% 가산(공휴일과 동일, 13시 기준 아님). 오전 09~13시도 가산.
 *   2. 표기 = '공휴일' 항목 체크(토요일 전용 체크박스 신설 없음).
 *   3. 가산율/코드/명칭 = 기존 공휴일 canon 재사용(30% / +050 / "(공휴일)"). 신규 발명 금지.
 *   4. 겹침 = 토요일 야간(18시~) → 공휴일 단일(기존 canon T-20260706).
 *
 * ⚠ cross-repo co-change: body 동일 canon(pair 티켓)과 로직 diff 일치·동시 배포. 한쪽만 배포 금지.
 * GO_WARN — 비즈로직·금액 재산정 정확성 assert 필수(순수함수 직접 import + 값 번들 변형 양측 검증).
 *
 * 2026-07-18 = 토요일(dow===6), 2026-07-13 = 월요일(평일). at() 는 로컬 Date 생성(월 0-index).
 */
const at = (y: number, m: number, d: number, hh: number, mm = 0) => new Date(y, m - 1, d, hh, mm);

test.describe('canon 판정 — 5종 시나리오 (토요일 오전/오후/야간겹침/09시경계/평일회귀)', () => {
  test('전제: 2026-07-18 은 토요일이며 법정공휴일 목록 밖(요일 판정만으로 holiday)', () => {
    expect(at(2026, 7, 18, 10).getDay()).toBe(6); // dow===6 = 토요일
    expect(KOREAN_HOLIDAYS_2026.has('2026-07-18')).toBe(false); // 법정공휴일 아님
  });

  test('시나리오1 토요일 오전(09~13시): 10:00 → holiday, 공휴일 박스만 체크(canon #1 오전 가산)', () => {
    const ref = at(2026, 7, 18, 10);
    const kind = detectSurchargeKind(ref, false);
    expect(kind).toBe('holiday'); // 13시 기준 아님 — 오전도 가산
    expect(isNightOrHoliday(ref, false)).toBe(true);
    expect(surchargeMark(kind, 'holiday')).toBe('■'); // canon #2 '공휴일' 항목 체크
    expect(surchargeMark(kind, 'night')).toBe(' '); // 토요일 전용 체크박스 신설 없음
  });

  test('시나리오2 토요일 오후: 14:00 → holiday', () => {
    const ref = at(2026, 7, 18, 14);
    expect(detectSurchargeKind(ref, false)).toBe('holiday');
    expect(isNightOrHoliday(ref, false)).toBe(true);
  });

  test('시나리오3 야간 겹침: 토요일 18:00 / 19:00 → holiday 단일(night 미적용, canon #4)', () => {
    const sat18 = at(2026, 7, 18, 18);
    const sat19 = at(2026, 7, 18, 19);
    expect(detectSurchargeKind(sat18, false)).toBe('holiday'); // 18시 겹침 → 공휴일 우선
    expect(detectSurchargeKind(sat19, false)).toBe('holiday');
    // 이중 가산 차단: 야간 박스 미체크(공휴일 단일)
    expect(surchargeMark(detectSurchargeKind(sat19, false), 'night')).toBe(' ');
    expect(surchargeMark(detectSurchargeKind(sat19, false), 'holiday')).toBe('■');
  });

  test('시나리오4 09시 경계: 토요일 09:00 → holiday, 08:59 → null(미개원, 회귀0)', () => {
    expect(detectSurchargeKind(at(2026, 7, 18, 9, 0), false)).toBe('holiday'); // 09시부터 가산
    expect(isNightOrHoliday(at(2026, 7, 18, 9, 0), false)).toBe(true);
    expect(detectSurchargeKind(at(2026, 7, 18, 8, 59), false)).toBeNull(); // 09시 이전 미가산
    expect(isNightOrHoliday(at(2026, 7, 18, 8, 59), false)).toBe(false);
  });

  test('시나리오5 평일 회귀: 월요일 주간 null / 월요일 19시 night (평일 로직 불변)', () => {
    const monNoon = at(2026, 7, 13, 14);
    const monNight = at(2026, 7, 13, 19);
    expect(monNoon.getDay()).toBe(1); // 월요일
    expect(detectSurchargeKind(monNoon, false)).toBeNull(); // 평일 주간 미가산
    expect(detectSurchargeKind(monNight, false)).toBe('night'); // 평일 야간 = night 유지
    // 평일 09~13시는 여전히 미가산(토요일 09시 규칙이 평일로 새지 않음)
    expect(detectSurchargeKind(at(2026, 7, 13, 10), false)).toBeNull();
    // 일요일 canon(dow===0) 회귀 없음
    expect(detectSurchargeKind(at(2026, 7, 19, 10), false)).toBe('holiday');
  });
});

test.describe('금액 재산정 정확성 (canon #3 공휴일 산식 재사용, GO_WARN 필수 assert)', () => {
  test('가산율 = 30% 상수 재사용(신규 요율 발명 없음)', () => {
    expect(SURCHARGE_RATE).toBe(0.3);
  });

  test('토요일 진찰료 급여 10,000(본인 3,000/공단 7,000) × 30% = 3,000 (본인 900/공단 2,100)', () => {
    const kind = detectSurchargeKind(at(2026, 7, 18, 10), false); // 토요일 오전
    const sc = computeSurcharge(10000, 3000, kind);
    expect(sc.amount).toBe(3000);
    expect(sc.copay).toBe(900);
    expect(sc.covered).toBe(2100);
    expect(sc.copay + sc.covered).toBe(sc.amount); // 분할 합 = 총액(누락·이중 없음)
  });

  test('bill_receipt_new 토요일 오전: 공휴일 체크(■) + 진찰료 30% 가산 금액 반영', () => {
    const base: Record<string, string> = {
      copayment: '3,000',
      insurance_covered: '7,000',
      total_amount: '10,000',
      subtotal_amount: '10,000',
      patient_amount: '3,000',
    };
    applyNightHolidaySurcharge(base, 'bill_receipt_new', false, new Set(), at(2026, 7, 18, 10), buildSurchargeDetailRowHtml);
    expect(base.holiday_mark).toBe('■');
    expect(base.night_mark).toBe(' ');
    expect(base.surcharge_kind_label).toBe('공휴일'); // canon #2 명칭 재사용
    expect(base.surcharge_amount).toBe('3,000');
    expect(base.copayment).toBe('3,900'); // 3,000 + 900
    expect(base.insurance_covered).toBe('9,100'); // 7,000 + 2,100
    expect(base.total_amount).toBe('13,000'); // 10,000 + 3,000
    expect(base.subtotal_amount).toBe('13,000');
    expect(base.patient_amount).toBe('3,900');
  });

  test('bill_detail 토요일 야간(겹침): 세부산정내역에 공휴일 가산 행 append(코드 050) — 야간행 아님', () => {
    const base: Record<string, string> = {
      subtotal_copayment: '3,000', subtotal_fund: '7,000',
      total_copayment: '3,000', total_fund: '7,000',
      subtotal_amount: '10,000', total_amount: '10,000',
      detail_subtotal: '3,000', detail_total: '3,000',
      items_html: '<tr><td>기존행</td></tr>', visit_date: '2026-07-18',
    };
    applyNightHolidaySurcharge(base, 'bill_detail', false, new Set(), at(2026, 7, 18, 19), buildSurchargeDetailRowHtml);
    expect(base.holiday_mark).toBe('■');
    expect(base.night_mark).toBe(' ');
    expect(base.items_html).toContain('공휴일 진료 가산 (30%)'); // canon #3 명칭
    expect(base.items_html).toContain('050'); // canon #3 공휴일 코드 suffix
    expect(base.items_html).not.toContain('야간 진료 가산'); // 겹침 시 야간행 미생성
    expect(base.items_html).toContain('기존행'); // 기존 항목 보존
    expect(base.total_amount).toBe('13,000');
  });

  test('토요일 09시 이전(08:59): 가산 없음 → 금액 불변(회귀0)', () => {
    const base: Record<string, string> = {
      copayment: '3,000', insurance_covered: '7,000', total_amount: '10,000',
      subtotal_amount: '10,000', patient_amount: '3,000',
    };
    applyNightHolidaySurcharge(base, 'bill_receipt_new', false, new Set(), at(2026, 7, 18, 8, 59), buildSurchargeDetailRowHtml);
    expect(base.holiday_mark).toBe(' ');
    expect(base.surcharge_amount).toBe('');
    expect(base.total_amount).toBe('10,000'); // 불변
  });
});
