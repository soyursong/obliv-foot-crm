import { test, expect } from '@playwright/test';
import {
  KOREAN_HOLIDAYS_2026,
  detectSurchargeKind,
  isNightOrHoliday,
} from '../../src/lib/nightHolidaySurcharge';

/**
 * E2E — T-20260817-foot-HOLIDAY-CHUSEOK-2026-WRONGYEAR-DATES (P2, census 부수발견 정정)
 * 급여 야간·공휴일 가산 목록(KOREAN_HOLIDAYS_2026)의 추석 항목이 2025 추석 연도(2026-09-30~10-02)로
 * 오복사되어 있던 것을 2026 관보 확정치(9/24~26)로 정정. isNightOrHoliday/detectSurchargeKind
 * 양 경로가 동일 Set 을 참조하므로 순수 함수 직접 import 로 결정론적 검증(AC-2).
 *
 * 2026 추석 = 9/25(당일·금), 연휴 9/24(전날·목)~9/26(다음날·토). 대체공휴일 없음(연휴 안에 일요일
 * 미포함, 9/27이 일요일). 출처 = 정부 공공 국가공휴일 목록(2026 관보 재대조).
 * ★9/26(토)은 토요일 가산(dow===6 && hour>=9)으로도 커버되나, 목록 등재는 종일(00~09시 포함) 공휴일
 *   판정을 보장 → 09시 이전 창(개원 전 서류 출력)에서 목록 기여를 격리 검증한다.
 */

// 특정 요일·시각의 로컬 Date (월 0-index). 주간 10시로 야간(18시~) 간섭 배제.
const at = (y: number, m: number, d: number, hh: number, mm = 0) => new Date(y, m - 1, d, hh, mm);

// 추석 연휴 중 평일(목·금) — 요일 canon 아닌 '공휴일 목록' 히트로만 가산돼야 하는 날.
const CHUSEOK_2026_WEEKDAY = ['2026-09-24', '2026-09-25'] as const;
const STALE_2025_CHUSEOK = ['2026-09-30', '2026-10-01', '2026-10-02'] as const;

test.describe('AC-1 — 2026 추석 연휴가 목록에 존재 + 공휴일 가산 자동판정(정상선택)', () => {
  for (const dateStr of CHUSEOK_2026_WEEKDAY) {
    test(`추석 ${dateStr} → KOREAN_HOLIDAYS_2026 포함 + holiday 판정(양 경로)`, () => {
      expect(KOREAN_HOLIDAYS_2026.has(dateStr)).toBe(true);
      const [y, m, d] = dateStr.split('-').map(Number);
      const ref = at(y, m, d, 10); // 주간 10시(야간 배제)
      // 9/24(목)·9/25(금) 은 평일 — 요일 canon 아닌 '공휴일 목록' 히트로만 가산돼야 함.
      expect([4, 5]).toContain(ref.getDay());
      expect(isNightOrHoliday(ref, false)).toBe(true);
      expect(detectSurchargeKind(ref, false)).toBe('holiday');
    });
  }

  test('추석 다음날 2026-09-26(토) → 목록 포함 + 09시 이전(종일) 공휴일 판정(목록 기여 격리)', () => {
    expect(KOREAN_HOLIDAYS_2026.has('2026-09-26')).toBe(true);
    const ref = at(2026, 9, 26, 8); // 토요일 08시 — 토요일 canon(09시~) 밖 → 목록 히트로만 가산
    expect(ref.getDay()).toBe(6); // 토요일
    expect(isNightOrHoliday(ref, false)).toBe(true);
    expect(detectSurchargeKind(ref, false)).toBe('holiday');
  });
});

test.describe('AC-2 — 구 2025 추석 오복사값(9/30~10/2)은 목록에서 제거 + 가산 미선택(오적용 차단)', () => {
  for (const dateStr of STALE_2025_CHUSEOK) {
    test(`구값 ${dateStr} → 목록 미포함 + 주간 평일 가산 미선택`, () => {
      expect(KOREAN_HOLIDAYS_2026.has(dateStr)).toBe(false);
      const [y, m, d] = dateStr.split('-').map(Number);
      const ref = at(y, m, d, 14); // 주간 14시
      // 2026-09-30(수)/10-01(목)/10-02(금) 은 평일 → 가산 없어야 함(구 오복사값 오적용 방지).
      expect([3, 4, 5]).toContain(ref.getDay());
      expect(isNightOrHoliday(ref, false)).toBe(false);
      expect(detectSurchargeKind(ref, false)).toBeNull();
    });
  }
});

test.describe('AC-3 — 추석 정정이 대체공휴일/기존 공휴일 판정을 회귀시키지 않음(평일 무영향·회귀)', () => {
  test('추석 연휴에 일요일 미포함(9/27이 일요일) → 별도 대체공휴일 불요', () => {
    // 9/24(목)~9/26(토) 전부 비-일요일. 대체공휴일 규칙(일요일 포함 시 발생) 미충족.
    for (const dateStr of ['2026-09-24', '2026-09-25', '2026-09-26']) {
      const [y, m, d] = dateStr.split('-').map(Number);
      expect(at(y, m, d, 10).getDay()).not.toBe(0);
    }
    // 연휴 밖 무관 평일(예: 9/28 월)은 목록 미포함 → 무영향.
    expect(KOREAN_HOLIDAYS_2026.has('2026-09-28')).toBe(false);
    expect(detectSurchargeKind(at(2026, 9, 28, 14), false)).toBeNull();
  });

  test('회귀 가드 — census 대체공휴일 4일 + 개천절/한글날 유지', () => {
    for (const dateStr of ['2026-03-02', '2026-05-25', '2026-08-17', '2026-10-05', '2026-10-03', '2026-10-09']) {
      expect(KOREAN_HOLIDAYS_2026.has(dateStr)).toBe(true);
    }
  });
});

test.describe('AC-5 — 부처님오신날 본일(5/24)+대체(5/25) 파리티(dev-body sweep fold-in, money-neutral)', () => {
  test('5/24 본일 → Set 포함 + 일요일(dow===0) + 공휴일 가산 자동판정(양 경로)', () => {
    // 2026 부처님오신날 = 음력 4/8 = 2026-05-24, 일요일.
    expect(KOREAN_HOLIDAYS_2026.has('2026-05-24')).toBe(true);
    const ref = at(2026, 5, 24, 10); // 주간 10시(야간 배제)
    expect(ref.getDay()).toBe(0); // 일요일
    expect(isNightOrHoliday(ref, false)).toBe(true);
    expect(detectSurchargeKind(ref, false)).toBe('holiday');
  });

  test('5/25 대체공휴일 → Set 포함 + 월요일 + 목록 히트로 공휴일 가산(요일 canon 아닌 목록 기여)', () => {
    expect(KOREAN_HOLIDAYS_2026.has('2026-05-25')).toBe(true);
    const ref = at(2026, 5, 25, 10); // 월요일 주간 10시
    expect(ref.getDay()).toBe(1); // 월요일 — 평일, 목록 히트로만 가산돼야 함
    expect(isNightOrHoliday(ref, false)).toBe(true);
    expect(detectSurchargeKind(ref, false)).toBe('holiday');
  });

  test('money-neutral 확증 — 5/24 는 일요일이라 목록 등재 유무와 무관하게 가산 결과 동일', () => {
    // 5/24 는 dow===0 종일 분기가 이미 커버 → Set 추가는 목적이 라벨/파리티지 금액 변동 아님.
    const ref = at(2026, 5, 24, 10);
    expect(ref.getDay()).toBe(0);
    // 일요일 canon 단독으로도 holiday(목록 무관). 목록 등재는 문서 정확성·body Set 파리티용.
    expect(detectSurchargeKind(ref, false)).toBe('holiday');
    // body 자매 Set 파리티: 본일+대체 둘 다 present.
    expect(KOREAN_HOLIDAYS_2026.has('2026-05-24') && KOREAN_HOLIDAYS_2026.has('2026-05-25')).toBe(true);
  });
});
