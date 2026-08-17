import { test, expect } from '@playwright/test';
import {
  slotWindowFor,
  slotsForDate,
  isOpenDay,
  closeTimeFor,
} from '../../src/lib/schedule';
import type { Clinic, OperatingHoursGeneration } from '../../src/lib/types';

/**
 * T-20260817-foot-RESVSLOT-OPHOURS-0930 — 종로 09-01 세대 시작시각 09:00→09:30 델타 self-test.
 *
 * 발주: 김주연 총괄 최종확정(MSG-20260817-130650-ffa8 via responder) → planner approved.
 * 확정 스펙(9/1 이후·종로점만):
 *   월~금 시작 09:30 / 마지막 슬롯 19:00(INCLUSIVE) / 30분
 *   토    시작 09:30 / 마지막 슬롯 18:00(INCLUSIVE) / 30분
 *   일    공식 휴무 유지(UI 휴무·실 예약 차단) = row-absent 무접촉(AC-4). 테스트슬롯 개방 = 별건(DA CONSULT 게이트).
 *
 * 부모 인프라: T-20260815-foot-JONGNO-OPHOURS-CHANGE-20260901 (clinic_operating_hours 세대 테이블·prod 배포).
 *   본 티켓 = 그 09-01 세대 6행의 open_time 만 09:00→09:30 data-only UPDATE.
 *
 * ★검증 대상 = 순수 resolver 함수(브라우저 불요·마이그 DDL 0). 실 DB 값 반영 검증 = supervisor POST-VERIFY(GO-token 후 apply).
 *   본 spec 은 "resolver 가 09:30 세대 데이터를 정확히 슬롯화하는가 + off-by-one 무 + forward-only 무교란"을 봉인한다.
 */

const SLOT_INTERVAL = 30;

// 2026-09-01 발효 세대 — 본 티켓 UPDATE 후 상태(open_time 09:30). 일(dow 0)=행 부재(휴무 row-absent 유지).
const GEN_20260901_0930: OperatingHoursGeneration[] = [
  { day_of_week: 1, open_time: '09:30', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null }, // 월
  { day_of_week: 2, open_time: '09:30', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null }, // 화
  { day_of_week: 3, open_time: '09:30', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null }, // 수
  { day_of_week: 4, open_time: '09:30', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null }, // 목
  { day_of_week: 5, open_time: '09:30', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null }, // 금
  { day_of_week: 6, open_time: '09:30', close_time: '19:00', last_booking_slot: '18:00', effective_from: '2026-09-01', effective_to: null }, // 토
];

// flat 3컬럼 = 현행(09-01 이전) 동작. close_time/weekend_close_time = EXCLUSIVE 저장(마지막슬롯+interval).
function makeClinic(withGen: boolean): Clinic {
  return {
    id: '74967aea-a60b-4da3-a0e7-9c997a930bc8',
    open_time: '10:00',
    close_time: '20:30',           // EXCLUSIVE (현행 flat)
    weekend_close_time: '18:30',   // EXCLUSIVE (현행 flat)
    slot_interval: SLOT_INTERVAL,
    operating_hours: withGen ? GEN_20260901_0930 : null,
  } as unknown as Clinic;
}

const D = (y: number, m: number, d: number) => new Date(y, m - 1, d);

// ═══════════════════════════════════════════════════════════════════════════
// T1 — 델타 착지: 첫 슬롯 09:30 (09:00 아님) · off-by-one: 마지막 슬롯 == last_booking_slot
// ═══════════════════════════════════════════════════════════════════════════
test.describe('T1: 시작 09:30 + 마지막슬롯 INCLUSIVE (09-01~)', () => {
  const clinic = makeClinic(true);

  test('T1-1: 평일(화 2026-09-01) 첫 슬롯 09:30 · 마지막 19:00 · 09:00 부재', () => {
    const slots = slotsForDate(D(2026, 9, 1), clinic); // getDay=2 (화)
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0]).toBe('09:30');                    // ★델타: 시작 09:30 (09:00 아님)
    expect(slots).not.toContain('09:00');              // 회귀 가드: 옛 시작 부재
    expect(slots[slots.length - 1]).toBe('19:00');     // off-by-one: 마지막 == last_booking_slot(불변)
    expect(slots).not.toContain('19:30');              // EXCLUSIVE close(19:30) 는 슬롯 아님
    expect(slots).not.toContain('20:00');
  });

  test('T1-2: 평일 EXCLUSIVE close = last_booking_slot + interval (파생·불변)', () => {
    const w = slotWindowFor(D(2026, 9, 1), clinic);
    expect(w.isClosed).toBe(false);
    expect(w.open).toBe('09:30');
    expect(w.close).toBe('19:30');                     // 19:00 + 30분 (마지막슬롯 불변)
  });

  test('T1-3: 토(2026-09-05) 첫 슬롯 09:30 · 마지막 18:00 · close 파생 18:30', () => {
    const w = slotWindowFor(D(2026, 9, 5), clinic);   // getDay=6 (토)
    expect(w.isClosed).toBe(false);
    expect(w.open).toBe('09:30');
    expect(w.close).toBe('18:30');
    const slots = slotsForDate(D(2026, 9, 5), clinic);
    expect(slots[0]).toBe('09:30');
    expect(slots[slots.length - 1]).toBe('18:00');
    expect(slots).not.toContain('18:30');
    expect(slots).not.toContain('09:00');
  });

  test('T1-4: 슬롯 그리드 정합 — 평일 09:30·10:00…19:00 (30분·19슬롯) / 토 09:30…18:00 (17슬롯)', () => {
    const wd = slotsForDate(D(2026, 9, 1), clinic);
    expect(wd).toEqual([
      '09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00',
      '14:30','15:00','15:30','16:00','16:30','17:00','17:30','18:00','18:30','19:00',
    ]);
    const sat = slotsForDate(D(2026, 9, 5), clinic);
    expect(sat[0]).toBe('09:30');
    expect(sat[sat.length - 1]).toBe('18:00');
    expect(sat.length).toBe(18); // 09:30~18:00 inclusive, 30분 → (510/30)+1 = 18
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T2 — 일요일 = 공식 휴무 유지(row-absent) · UI 휴무 · 실 예약 차단 (AC-4 무변)
//   ★테스트용 슬롯 개방(row-present+is_closed)은 신규 컬럼 필요 → 08-15 DA 결정 역행 → 본 티켓 out-of-scope.
//     DA CONSULT 게이트 경유 별건. 본 spec 은 "일요일 실차단 무변" 만 봉인한다.
// ═══════════════════════════════════════════════════════════════════════════
test.describe('T2: 일요일 공식 휴무 유지 (실 예약 차단 무변)', () => {
  const clinic = makeClinic(true);

  test('T2-1: 일(2026-09-06) isOpenDay=false · slotsForDate=[] · 부킹 차단 유지', () => {
    const sunday = D(2026, 9, 6); // getDay=0 (일)
    expect(isOpenDay(sunday, clinic)).toBe(false);       // UI 휴무 + 폼/제출 실차단
    expect(slotsForDate(sunday, clinic)).toEqual([]);     // 슬롯 0 (row-absent)
    expect(slotWindowFor(sunday, clinic).isClosed).toBe(true);
  });

  test('T2-2: 평일/토는 영업(isOpenDay=true)', () => {
    expect(isOpenDay(D(2026, 9, 1), clinic)).toBe(true); // 화
    expect(isOpenDay(D(2026, 9, 5), clinic)).toBe(true); // 토
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T3 — forward-only: 2026-08-31 이전 = flat fallback (현행 09:00→10:00 flat 무교란·회귀 0)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('T3: 09-01 이전 = flat 무교란 (forward-only)', () => {
  const clinic = makeClinic(true); // 09-01 세대(09:30) 부착돼도 이전 날짜는 커버 안 됨 → flat

  test('T3-1: 평일(금 2026-08-14) = flat open 10:00 · 마지막 20:00 (세대 09:30 무영향)', () => {
    const day = D(2026, 8, 14); // getDay=5 (금)
    const w = slotWindowFor(day, clinic);
    expect(w.isClosed).toBe(false);
    expect(w.open).toBe(clinic.open_time);              // '10:00' flat (09:30 아님)
    expect(w.close).toBe(closeTimeFor(day, clinic));    // flat close '20:30'
    const slots = slotsForDate(day, clinic);
    expect(slots[0]).toBe('10:00');
    expect(slots).not.toContain('09:30');               // 09-01 델타 09:30 이 과거로 새지 않음
    expect(slots[slots.length - 1]).toBe('20:00');
  });

  test('T3-2: 2026-08-16(일) = 현행 영업(flat, 휴무 아님) — 일요일 휴무는 forward-only 09-01 부터', () => {
    const sunday = D(2026, 8, 16); // getDay=0 (일), 09-01 이전
    expect(isOpenDay(sunday, clinic)).toBe(true);       // 이전 일요일은 영업(회귀 0)
    const slots = slotsForDate(sunday, clinic);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[slots.length - 1]).toBe('18:00');      // flat weekend
  });
});
