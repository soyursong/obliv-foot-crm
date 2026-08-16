import { test, expect } from '@playwright/test';
import {
  slotWindowFor,
  slotsForDate,
  isOpenDay,
  closeTimeFor,
  generateSlots,
} from '../../src/lib/schedule';
import type { Clinic, OperatingHoursGeneration } from '../../src/lib/types';

/**
 * T-20260815-foot-JONGNO-OPHOURS-CHANGE-20260901 — date-aware 운영시간 세대 resolver self-test.
 *
 * 발주: CEO MISSION(MSG-20260815-150459-1ma4) — jongno-foot 2026-09-01 forward-only 운영시간 변경.
 *   평일(월~금) 마지막 신규예약 슬롯 19:00 / 토 18:00 / 일 휴무.
 *
 * DA CONSULT-REPLY (2건 정합 — 아래 §DA 정합 참조):
 *   · MSG-20260815-155009-sa8v (P1, ref DA-...-CHANGE-20260901): Q3 = INCLUSIVE last_booking_slot 저장 canonical.
 *   · MSG-20260815-154808-3yen / -154824-cp5l (ref DA-...-CHANGE): Q3 = ★수정요청(load-bearing).
 *       flat 컬럼이 이미 EXCLUSIVE-close 저장이므로 (A)close_exclusive 강권 / (B)INCLUSIVE 유지도 acceptable —
 *       단 (B) 채택 시 [컬럼 comment + SSOT 명문화 + resolver 변환지점 단일화 + off-by-one self-test] 의무.
 *
 * §DA 정합(reconciliation): 본 구현 = INCLUSIVE 저장(sa8v 지정) = 3yen 옵션 (B). 따라서 3yen 옵션-B 4가드 충족이 필수다.
 *   [가드1] 컬럼 comment          → migration COMMENT ON COLUMN last_booking_slot/close_time (INCLUSIVE↔EXCLUSIVE 명시). ✓
 *   [가드2] SSOT 명문화           → types.ts OperatingHoursGeneration + schedule.ts slotWindowFor 주석 + 본 spec §DA. ✓
 *   [가드3] resolver 변환지점 단일화 → slotWindowFor 의 addMinutes(last_booking_slot, slot_interval) 단 1곳. ✓ (T3 검증)
 *   [가드4] off-by-one self-test  → 본 spec T1(마지막 슬롯 == last_booking_slot). ✓
 *   그리고 DA Q1(fallback) self-test → 본 spec T4/T5(2026-08-31 이전 조회일 = flat 값, 회귀 0).
 *
 * ★검증 대상 = 순수 resolver 함수(브라우저 불요). 실 DB/렌더 검증은 supervisor DDL-diff + POST-VERIFY(GO-token 후 apply).
 * ★DDL 은 dev 선-apply 금지(AC-1) — 본 spec 은 코드 자산의 논리 정합만 봉인한다.
 */

// jongno-foot 슬롯 간격(clinics.slot_interval) — resolver 는 live clinic.slot_interval 을 읽으므로 하드코딩 아님.
//   seed 는 last_booking_slot(INCLUSIVE) 만 저장하고 interval 은 read-time 적용 → interval 변경에도 저장데이터 무변(옵션 B 이점).
const SLOT_INTERVAL = 30;

// 2026-09-01 발효 세대(jongno seed 미러). 일(dow 0) = 행 부재(휴무 = row-absent negative-space, DA Q4).
const GEN_20260901: OperatingHoursGeneration[] = [
  { day_of_week: 1, open_time: '09:00', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null }, // 월
  { day_of_week: 2, open_time: '09:00', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null }, // 화
  { day_of_week: 3, open_time: '09:00', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null }, // 수
  { day_of_week: 4, open_time: '09:00', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null }, // 목
  { day_of_week: 5, open_time: '09:00', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null }, // 금
  { day_of_week: 6, open_time: '09:00', close_time: '19:00', last_booking_slot: '18:00', effective_from: '2026-09-01', effective_to: null }, // 토
];

// flat 3컬럼 = 현행(2026-08-31 이전) 동작. close_time/weekend_close_time 은 EXCLUSIVE 저장(마지막슬롯+interval).
//   현행: 평일 close_time '20:30' → 마지막슬롯 20:00 / 토·일 weekend_close_time '18:30' → 마지막슬롯 18:00.
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

// 로컬(Asia/Seoul 런타임) 캘린더 날짜 — TZ 드리프트 회피 위해 (y, m-1, d) 로컬 생성자 사용.
const D = (y: number, m: number, d: number) => new Date(y, m - 1, d);

// ═══════════════════════════════════════════════════════════════════════════
// T1 — [가드4] off-by-one self-test: 마지막 슬롯 == last_booking_slot (신 세대, 2026-09-01~)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('T1: off-by-one — 마지막 슬롯 == last_booking_slot (INCLUSIVE)', () => {
  const clinic = makeClinic(true);

  test('T1-1: 평일(화 2026-09-01) 마지막 슬롯 = 19:00 = last_booking_slot', () => {
    const slots = slotsForDate(D(2026, 9, 1), clinic); // getDay=2 (화)
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[slots.length - 1]).toBe('19:00'); // off-by-one 가드: 마지막 == last_booking_slot
    expect(slots[0]).toBe('09:00');
    expect(slots).not.toContain('19:30'); // EXCLUSIVE close(19:30) 는 슬롯 아님
    expect(slots).not.toContain('20:00');
  });

  test('T1-2: 평일 EXCLUSIVE close = last_booking_slot + slot_interval (파생·저장 아님)', () => {
    const w = slotWindowFor(D(2026, 9, 1), clinic);
    expect(w.isClosed).toBe(false);
    expect(w.open).toBe('09:00');
    expect(w.close).toBe('19:30'); // 19:00 + 30분 = EXCLUSIVE 상한
  });

  test('T1-3: 토(2026-09-05) 마지막 슬롯 = 18:00 = last_booking_slot / close 파생 18:30', () => {
    const w = slotWindowFor(D(2026, 9, 5), clinic); // getDay=6 (토)
    expect(w.isClosed).toBe(false);
    expect(w.close).toBe('18:30');
    const slots = slotsForDate(D(2026, 9, 5), clinic);
    expect(slots[slots.length - 1]).toBe('18:00');
    expect(slots).not.toContain('18:30');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T2 — 휴무(일요일) = row-absent negative-space (is_closed 컬럼 없음, DA Q4)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('T2: 일요일 휴무 = 슬롯 0 + 예약 불가', () => {
  const clinic = makeClinic(true);

  test('T2-1: 일(2026-09-06) isOpenDay=false + slotsForDate=[]', () => {
    const sunday = D(2026, 9, 6); // getDay=0 (일)
    expect(isOpenDay(sunday, clinic)).toBe(false);
    expect(slotsForDate(sunday, clinic)).toEqual([]);
    expect(slotWindowFor(sunday, clinic).isClosed).toBe(true);
  });

  test('T2-2: 평일/토는 영업(isOpenDay=true)', () => {
    expect(isOpenDay(D(2026, 9, 1), clinic)).toBe(true); // 화
    expect(isOpenDay(D(2026, 9, 5), clinic)).toBe(true); // 토
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T3 — [가드3] resolver 변환지점 단일화: EXCLUSIVE close = last_booking_slot + interval 는 코드 1곳
// ═══════════════════════════════════════════════════════════════════════════
test.describe('T3: INCLUSIVE→EXCLUSIVE 변환지점 단일화', () => {
  test('T3-1: schedule.ts 에 addMinutes(row.last_booking_slot, ...) 변환 정확히 1회', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.resolve('src/lib/schedule.ts'), 'utf-8');
    const hits = src.match(/addMinutes\(\s*row\.last_booking_slot/g) ?? [];
    expect(hits.length, 'last_booking_slot→EXCLUSIVE 변환은 slotWindowFor 단 1곳(중복 금지)').toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T4/T5 — [DA Q1] forward-only fallback: 2026-08-31 이전 조회일 = flat 값(현행 동작 100% 보존, 회귀 0)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('T4: 2026-08-31 이전 = flat fallback (세대행 무시, forward-only)', () => {
  const clinic = makeClinic(true); // 세대(09-01)가 부착돼 있어도 이전 날짜는 커버 안 됨 → flat

  test('T4-1: 평일(금 2026-08-14) = flat close_time(EXCLUSIVE 20:30) → 마지막 슬롯 20:00', () => {
    const day = D(2026, 8, 14); // getDay=5 (금)
    const w = slotWindowFor(day, clinic);
    expect(w.isClosed).toBe(false);
    expect(w.open).toBe(clinic.open_time);           // '10:00'
    expect(w.close).toBe(closeTimeFor(day, clinic));  // flat close_time '20:30'
    const slots = slotsForDate(day, clinic);
    expect(slots[slots.length - 1]).toBe('20:00');    // 현행 동작(19:00 아님) 유지
    expect(slots[0]).toBe('10:00');                   // 현행 open 유지(09:00 아님)
  });

  test('T4-2: DA Q1 지정 케이스 — 2026-08-15(토) 조회 = flat 값(weekend_close_time EXCLUSIVE 18:30)', () => {
    const day = D(2026, 8, 15); // getDay=6 (토)
    const w = slotWindowFor(day, clinic);
    expect(w.isClosed).toBe(false);                   // 08-15 토는 현행 영업(일요일 휴무는 09-01~)
    expect(w.close).toBe(clinic.weekend_close_time);  // '18:30' flat
    const slots = slotsForDate(day, clinic);
    expect(slots[slots.length - 1]).toBe('18:00');    // 현행 동작
  });

  test('T4-3: 2026-08-16(일) 조회 = 현행 영업(flat, 휴무 아님) — 일요일 휴무는 forward-only 09-01 부터', () => {
    const sunday = D(2026, 8, 16); // getDay=0 (일), 09-01 이전
    expect(isOpenDay(sunday, clinic)).toBe(true);     // 이전 일요일은 영업(회귀 0)
    const slots = slotsForDate(sunday, clinic);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[slots.length - 1]).toBe('18:00');    // flat weekend
  });
});

test.describe('T5: resolver fallback == 기존 closeTimeFor/generateSlots 경로 (DA Q1 등가 증명)', () => {
  test('T5-1: 세대 부재 clinic(operating_hours=null) 도 동일 flat 경로', () => {
    const bare = makeClinic(false); // operating_hours 없음(미배포 DB 시뮬)
    for (const [y, m, d] of [[2026, 8, 14], [2026, 8, 15], [2026, 9, 1], [2026, 9, 6]] as const) {
      const day = D(y, m, d);
      const viaResolver = slotsForDate(day, bare);
      const viaLegacy = generateSlots(bare.open_time, closeTimeFor(day, bare), bare.slot_interval);
      expect(viaResolver, `${y}-${m}-${d} 세대미배포 = legacy 경로 등가`).toEqual(viaLegacy);
    }
  });
});
