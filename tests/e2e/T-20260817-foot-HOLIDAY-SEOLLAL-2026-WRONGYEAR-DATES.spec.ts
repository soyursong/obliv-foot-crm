import { test, expect } from '@playwright/test';
import {
  KOREAN_HOLIDAYS_2026,
  detectSurchargeKind,
  isNightOrHoliday,
} from '../../src/lib/nightHolidaySurcharge';

/**
 * E2E — T-20260817-foot-HOLIDAY-SEOLLAL-2026-WRONGYEAR-DATES (P2, census 부수발견 정정)
 * 급여 야간·공휴일 가산 목록(KOREAN_HOLIDAYS_2026)의 설날 항목이 2025 설날(2026-01-28~30)로
 * 오복사되어 있던 것을 2026 관보 확정치(2/16~18)로 정정. isNightOrHoliday/detectSurchargeKind
 * 양 경로가 동일 Set 을 참조하므로 순수 함수 직접 import 로 결정론적 검증.
 *
 * 2026 설날 = 2/17(당일·화), 연휴 2/16(전날·월)~2/18(다음날·수). 3일 전부 평일 → 대체공휴일 없음.
 * 출처 = 우주항공청 「2026년 월력요항」 / 정부 공공 국가공휴일 목록(2026 관보 재대조).
 */

// 특정 요일·시각의 로컬 Date (월 0-index). 주간 10시로 야간(18시~) 간섭 배제.
const at = (y: number, m: number, d: number, hh: number, mm = 0) => new Date(y, m - 1, d, hh, mm);

const SEOLLAL_2026 = ['2026-02-16', '2026-02-17', '2026-02-18'] as const;
const STALE_2025_SEOLLAL = ['2026-01-28', '2026-01-29', '2026-01-30'] as const;

test.describe('AC-1 — 2026 설날 연휴 3일이 목록에 존재 + 공휴일 가산 자동판정', () => {
  for (const dateStr of SEOLLAL_2026) {
    test(`설날 ${dateStr} → KOREAN_HOLIDAYS_2026 포함 + holiday 판정(양 경로)`, () => {
      expect(KOREAN_HOLIDAYS_2026.has(dateStr)).toBe(true);
      const [y, m, d] = dateStr.split('-').map(Number);
      const ref = at(y, m, d, 10); // 주간 10시(야간 배제)
      // 3일 전부 평일(월·화·수) — 요일 canon 아닌 '공휴일 목록' 히트로만 가산돼야 함.
      expect([1, 2, 3]).toContain(ref.getDay());
      expect(isNightOrHoliday(ref, false)).toBe(true);
      expect(detectSurchargeKind(ref, false)).toBe('holiday');
    });
  }
});

test.describe('AC-2 — 구 2025 설날 오복사값(1/28~30)은 목록에서 제거 + 가산 미선택', () => {
  for (const dateStr of STALE_2025_SEOLLAL) {
    test(`구값 ${dateStr} → 목록 미포함 + 주간 평일 가산 미선택(오적용 차단)`, () => {
      expect(KOREAN_HOLIDAYS_2026.has(dateStr)).toBe(false);
      const [y, m, d] = dateStr.split('-').map(Number);
      const ref = at(y, m, d, 14); // 주간 14시
      // 2026-01-28(수)/29(목)/30(금) 은 평일 → 가산 없어야 함(구 오복사값으로 인한 오적용 방지).
      expect([3, 4, 5]).toContain(ref.getDay());
      expect(isNightOrHoliday(ref, false)).toBe(false);
      expect(detectSurchargeKind(ref, false)).toBeNull();
    });
  }
});

test.describe('AC-3 — 설날 정정이 대체공휴일/기존 공휴일 판정을 회귀시키지 않음', () => {
  test('설날 3일은 평일이므로 대체공휴일 미발생(2/16~18 전부 비주말)', () => {
    for (const dateStr of SEOLLAL_2026) {
      const [y, m, d] = dateStr.split('-').map(Number);
      const dow = at(y, m, d, 10).getDay();
      expect(dow).not.toBe(0); // 일요일 아님
      expect(dow).not.toBe(6); // 토요일 아님 → 별도 대체공휴일 불요
    }
  });

  test('회귀 가드 — census 대체공휴일 4일 유지', () => {
    for (const dateStr of ['2026-03-02', '2026-05-25', '2026-08-17', '2026-10-05']) {
      expect(KOREAN_HOLIDAYS_2026.has(dateStr)).toBe(true);
    }
  });
});
