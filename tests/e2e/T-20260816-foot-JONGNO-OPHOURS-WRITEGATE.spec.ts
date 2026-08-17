import { test, expect } from '@playwright/test';
import { isNewResvOutOfWindow, OPHOURS_GATE_EFFECTIVE_FROM } from '../../src/lib/schedule';
import type { Clinic, OperatingHoursGeneration } from '../../src/lib/types';

/**
 * T-20260816-foot-JONGNO-OPHOURS-WRITEGATE (Phase2·차단축) — 신규예약 out-of-window 예측자 self-test.
 *
 * 발주: CEO DECISION MSG-20260818-070213-u1rx (gate_scope 확정·Phase2 GO).
 *   · 외부/도파민 인입 = HARD 차단(서버 EF reservation-ingest-from-dopamine 가 동일 규칙 isOutOfWindowEf 로 거부).
 *   · 스태프 직접입력 = (i) soft(confirmStaffResvWindow 가 이 예측자로 판정 → 경고 후 진행).
 *   본 spec 은 공유 차단축 규칙(isNewResvOutOfWindow, src/lib/schedule.ts)의 논리 정합을 봉인한다.
 *
 * ★검증 대상 = 순수 예측자(브라우저 불요). 서버 EF(Deno) 는 동일 규칙을 verbatim 재구현(isOutOfWindowEf) —
 *   실 TM 화면 거부 노출 실측(방침 4)은 supervisor/현장 confirm 단계(footPushErrorMessage non-swallow).
 * ★HARD 가드: forward-only(>=2026-09-01)·표시축 무접촉·세대 미커버 fail-open(과대차단 방지).
 */

const SLOT_INTERVAL = 30;

// 2026-09-01 발효 세대(jongno seed 미러, CHANGE-20260901 정본). 일(dow 0) = 행 부재(휴무 = row-absent).
const GEN_20260901: OperatingHoursGeneration[] = [
  { day_of_week: 1, open_time: '09:00', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null }, // 월
  { day_of_week: 2, open_time: '09:00', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null }, // 화
  { day_of_week: 3, open_time: '09:00', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null }, // 수
  { day_of_week: 4, open_time: '09:00', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null }, // 목
  { day_of_week: 5, open_time: '09:00', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null }, // 금
  { day_of_week: 6, open_time: '09:00', close_time: '19:00', last_booking_slot: '18:00', effective_from: '2026-09-01', effective_to: null }, // 토
];

function makeClinic(withGen: boolean): Clinic {
  return {
    id: '74967aea-a60b-4da3-a0e7-9c997a930bc8',
    open_time: '10:00',
    close_time: '20:30',           // EXCLUSIVE (현행 flat)
    weekend_close_time: '18:30',   // EXCLUSIVE (현행 flat)
    slot_interval: SLOT_INTERVAL,
    operating_hours: withGen ? GEN_20260901 : null,
  } as unknown as Clinic;
}

const D = (y: number, m: number, d: number) => new Date(y, m - 1, d);

// ═══════════════════════════════════════════════════════════════════════════
// T1 — forward-only: 2026-09-01 이전은 항상 통과(현행 무교란)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('T1: forward-only — 08-31 이전 무교란', () => {
  const clinic = makeClinic(true);

  test('T1-1: gate 발효일 상수 = 2026-09-01', () => {
    expect(OPHOURS_GATE_EFFECTIVE_FROM).toBe('2026-09-01');
  });
  test('T1-2: 2026-08-31(월) 19:30 창밖 시각도 false(forward-only 무교란)', () => {
    expect(isNewResvOutOfWindow(D(2026, 8, 31), '19:30', clinic)).toBe(false);
  });
  test('T1-3: 2026-08-30(일) 임의 시각도 false(이전 일요일은 현행 영업)', () => {
    expect(isNewResvOutOfWindow(D(2026, 8, 30), '14:00', clinic)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T2 — 평일(2026-09-01~) 운영창 경계 (open 09:00 / last-slot 19:00 INCLUSIVE / close 19:30 EXCLUSIVE)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('T2: 평일 운영창 경계', () => {
  const clinic = makeClinic(true);
  const tue = D(2026, 9, 1); // getDay=2 (화)

  test('T2-1: 09:00(open) = 창 안 → false', () => {
    expect(isNewResvOutOfWindow(tue, '09:00', clinic)).toBe(false);
  });
  test('T2-2: 19:00(마지막 슬롯, INCLUSIVE) = 창 안 → false', () => {
    expect(isNewResvOutOfWindow(tue, '19:00', clinic)).toBe(false);
  });
  test('T2-3: 19:30(창밖·census 지배 유형) → true(차단 후보)', () => {
    expect(isNewResvOutOfWindow(tue, '19:30', clinic)).toBe(true);
  });
  test('T2-4: 20:00(창밖) → true', () => {
    expect(isNewResvOutOfWindow(tue, '20:00', clinic)).toBe(true);
  });
  test('T2-5: 08:30(open 이전) → true', () => {
    expect(isNewResvOutOfWindow(tue, '08:30', clinic)).toBe(true);
  });
  test('T2-6: HH:MM:SS 형식(19:30:00)도 동일 판정 → true', () => {
    expect(isNewResvOutOfWindow(tue, '19:30:00', clinic)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T3 — 토(last-slot 18:00 / close 18:30 EXCLUSIVE) + 일(휴무 = 전건 차단)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('T3: 토 경계 + 일 휴무', () => {
  const clinic = makeClinic(true);

  test('T3-1: 토(09-05) 18:00(마지막 슬롯) = 창 안 → false', () => {
    expect(isNewResvOutOfWindow(D(2026, 9, 5), '18:00', clinic)).toBe(false);
  });
  test('T3-2: 토(09-05) 18:30(창밖) → true', () => {
    expect(isNewResvOutOfWindow(D(2026, 9, 5), '18:30', clinic)).toBe(true);
  });
  test('T3-3: 일(09-06) 휴무 = 임의 시각 전건 차단 후보 → true', () => {
    expect(isNewResvOutOfWindow(D(2026, 9, 6), '14:00', clinic)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T4 — fail-open(과대차단 방지): clinic 미제공 / 세대 미로드(flat fallback)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('T4: fail-open', () => {
  test('T4-1: clinic 미제공(null) → false(판정 불가 = 무차단)', () => {
    expect(isNewResvOutOfWindow(D(2026, 9, 1), '19:30', null)).toBe(false);
  });
  test('T4-2: 세대 미로드(flat only) 09-01 창밖 시각도 false(flat fallback = 무교란)', () => {
    const flat = makeClinic(false);
    expect(isNewResvOutOfWindow(D(2026, 9, 1), '19:30', flat)).toBe(false);
  });
  test('T4-3: time 미제공 → false', () => {
    expect(isNewResvOutOfWindow(D(2026, 9, 1), '', makeClinic(true))).toBe(false);
  });
});
