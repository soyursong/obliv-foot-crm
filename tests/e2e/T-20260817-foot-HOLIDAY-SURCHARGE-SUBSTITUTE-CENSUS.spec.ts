import { test, expect } from '@playwright/test';
import {
  KOREAN_HOLIDAYS_2026,
  detectSurchargeKind,
  isNightOrHoliday,
} from '../../src/lib/nightHolidaySurcharge';

/**
 * E2E — T-20260817-foot-HOLIDAY-SURCHARGE-SUBSTITUTE-CENSUS (P1, body P0 자매 census)
 * foot 급여 야간·공휴일 가산 목록(KOREAN_HOLIDAYS_2026)에 2026 대체공휴일 누락 여부 census + 동기 수정.
 *
 * 관보 확정 2026 대체공휴일(전부 월요일) = 4일:
 *   3/2(삼일절 3/1 일요일 대체) · 5/25(부처님오신날 5/24 일요일 대체) ·
 *   8/17(광복절 8/15 토요일 대체) · 10/5(개천절 10/3 토요일 대체).
 * ★2026-06-08 은 대체공휴일 아님 — 현충일(6/6 토)은 대체공휴일 비대상(관보 대조 확정, 추가 금지).
 *
 * 순수 함수 직접 import 로 결정론적 판정 검증(가산 판정 canon 불변).
 */

// 특정 요일·시각의 로컬 Date (월 0-index). 주간 시각(10시)으로 야간(18시~) 간섭 배제.
const at = (y: number, m: number, d: number, hh: number, mm = 0) => new Date(y, m - 1, d, hh, mm);

// 관보 확정 대체공휴일(월요일) — 주간 10시 기준이면 오직 '공휴일 목록' 히트로만 가산 판정돼야 함.
const SUBSTITUTE_HOLIDAYS = ['2026-03-02', '2026-05-25', '2026-08-17', '2026-10-05'] as const;

test.describe('AC-1/AC-2 — 2026 대체공휴일 4일이 목록에 존재 + 공휴일 가산 자동판정', () => {
  for (const dateStr of SUBSTITUTE_HOLIDAYS) {
    test(`대체공휴일 ${dateStr} → KOREAN_HOLIDAYS_2026 포함 + holiday 판정`, () => {
      expect(KOREAN_HOLIDAYS_2026.has(dateStr)).toBe(true);
      const [y, m, d] = dateStr.split('-').map(Number);
      const ref = at(y, m, d, 10); // 월요일 주간 10시
      expect(ref.getDay()).toBe(1); // 4일 모두 월요일
      // 평일 월요일이지만 대체공휴일이므로 holiday 가산 자동선택돼야 함.
      expect(isNightOrHoliday(ref, false)).toBe(true);
      expect(detectSurchargeKind(ref, false)).toBe('holiday');
    });
  }
});

test.describe('AC-2 — 2026-06-08 은 대체공휴일 아님(현충일 토요일 비대상, 오적용 차단)', () => {
  test('2026-06-08(월) → 목록 미포함 + 가산 미선택', () => {
    expect(KOREAN_HOLIDAYS_2026.has('2026-06-08')).toBe(false);
    const ref = at(2026, 6, 8, 10); // 월요일 주간 10시 — 정상 근무일
    expect(ref.getDay()).toBe(1);
    expect(isNightOrHoliday(ref, false)).toBe(false);
    expect(detectSurchargeKind(ref, false)).toBeNull();
  });

  test('현충일 6/6(토) 09시 이후는 토요일 canon 으로 가산 — 대체와 무관', () => {
    // 회귀 가드: 6/6 토요일 자체는 기존 토요일 09시~ canon 으로 holiday. 6/8 로 대체되지 않음.
    const sat = at(2026, 6, 6, 10);
    expect(sat.getDay()).toBe(6);
    expect(detectSurchargeKind(sat, false)).toBe('holiday');
  });
});

test.describe('시나리오 2 — 평일 무영향(회귀0)', () => {
  const WEEKDAYS = ['2026-03-03', '2026-08-18', '2026-10-06', '2026-06-09'] as const;
  for (const dateStr of WEEKDAYS) {
    test(`평일 ${dateStr} 주간 → 가산 미선택`, () => {
      const [y, m, d] = dateStr.split('-').map(Number);
      const ref = at(y, m, d, 14); // 주간 14시
      expect(KOREAN_HOLIDAYS_2026.has(dateStr)).toBe(false);
      expect(isNightOrHoliday(ref, false)).toBe(false);
      expect(detectSurchargeKind(ref, false)).toBeNull();
    });
  }
});
