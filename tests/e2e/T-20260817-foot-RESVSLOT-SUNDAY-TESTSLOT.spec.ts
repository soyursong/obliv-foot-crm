import { test, expect } from '@playwright/test';
import {
  slotWindowFor,
  slotsForDate,
  isOpenDay,
} from '../../src/lib/schedule';
import type { Clinic, OperatingHoursGeneration } from '../../src/lib/types';

/**
 * T-20260817-foot-RESVSLOT-SUNDAY-TESTSLOT — 일요일 "테스트 슬롯" 데이터 존재 ⊥ 일요일 운영 (negative-space 유지).
 *
 * 발주: 김주연 총괄 — "일요일 테스트 슬롯 데이터는 있어야 하되(내부 테스트용), 환자에겐 절대 안 보이고
 *       일요일이 '운영일'로 선언되어서도 안 된다."
 *
 * DA CONSULT-REPLY (SSOT = agents/docs/da_replies/da_decision_foot_resvslot_sunday_testslot_20260817.md):
 *   verdict = NEGATIVE-SPACE-MAINTAIN. `clinic_operating_hours` 에 is_closed/휴무 플래그 축 신설 = REJECT
 *   (DA-20260815 Q4 REAFFIRM). category-error 지목: '일요일 테스트슬롯 데이터 존재' ≠ 'clinic 일요일 운영'.
 *   착지축 = is_test cross-CRM canonical (NOT is_closed). 일요일 = 여전히 휴무(row-absent negative-space)이고,
 *   다만 일부 슬롯이 테스트-스코프로만 존재하며 환자-facing 에는 절대 미노출.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * dev-foot firsthand census (blind-assert 금지 · 4문 실측 완료 2026-08-17):
 *   ① slot-gen 소스: operating_hours 는 '개점일/가용성 게이트'(isOpenDay/slotsForDate/weekSlotRange)의 소스이나
 *      **커버 세대가 있을 때만** — 없으면 flat-fallback(clinics 3컬럼). 신규/reschedule 시간 picker 는 고정
 *      RESV_TIME_GRID(07:00~22:00). ⇒ operating_hours 는 유일소스도 하드와이어도 아님. **물리 slot 테이블 없음**(in-memory 생성).
 *   ② '테스트슬롯 존재' 의미: 물리 slot 테이블이 없으므로 '일요일 슬롯 물질화' = clinic_operating_hours 에 일요일
 *      세대행 1건 추가 = 렌더 + isOpenDay 통과 = 환자-facing(AC-4 위반). ⇒ 요구의 실체는 '테스터가 일요일 슬롯을
 *      쓸 수 있음'이지 'prod 환자 가용성 fact'가 아님.
 *   ③ 환경 분리: **별도 격리 DB 실재** — obliv-foot-dev(kcdqtyivtqcjmcrdjkqi, PHI-0, E2E/CI). prod=rxlomoozakkjesdqjtvd.
 *      격리 DB 에는 clinic_operating_hours 테이블이 **미배포**(to_regclass=null) ⇒ flat-fallback ⇒ **일요일 이미 개방**.
 *   ④ is_test 컬럼: clinic_operating_hours 에 **없음**(롱레 verbatim mirror·is_closed/is_test 부재). slot 테이블 없음.
 *      기존 테스트축 = is_simulation(money-grain + customers-grain view-hide).
 *
 * ⇒ 착지 = **랭킹 #1 (환경/테스트모드 게이트) [cleanest · DDL 0 · db_change=false · operating_hours 무접촉]**.
 *   두-환경 split 이 이미 정확한 결과를 **어떤 write 도 없이** 산출한다:
 *     · 격리 DB(obliv-foot-dev): 세대 테이블 미배포 → flat-fallback → 일요일 개방 → 테스터가 일요일 테스트슬롯 확보(자연).
 *     · prod: 09-01 세대 존재 · 일요일 row-absent → 09-01~ 일요일 휴무(환자 미노출). census 실측 = prod 일요일 세대행 0건.
 *   ⇒ 랭킹 #2(is_test-scoped 세대행)은 **단일 prod DB 전제** 위에서만 필요 — ③가 그 전제를 falsify → 불요.
 *      is_closed 축 = 시종 무접촉(REJECT). is_test 컬럼 operating_hours 추가 = 불요.
 *
 * ★검증 대상 = 순수 resolver 함수(브라우저·DB 불요). 본 spec 은 착지 결정을 회귀-lock 한다:
 *   (A) AC-4 POST-VERIFY 3중 assertion (prod-shape) — 환자 일요일 슬롯 미노출 · 부킹 차단 무변 · 내부 테스트슬롯 인지 가능.
 *   (B) 대칭 negative-space 증명 — 일요일 = 세대행 부재(휴무) ⟺ 세대행 존재(개방). is_closed/is_test 컬럼 불요.
 *   (C) 무회귀 — 평일/토요일 prod 동작 무변.
 *
 * ★no prod change: db_change=false · DDL 0 · operating_hours 무접촉 · GO-token N/A(no apply). reporter confirm gate 대상.
 */

const SLOT_INTERVAL = 30;

// ── prod-shape 세대(2026-09-01 발효, prod 실측 미러) — 일(dow 0) = 행 부재(휴무 row-absent). ──
//   ※ 본 티켓은 이 세대를 **읽기만** 한다. 값 변경/행 추가 없음(operating_hours 무접촉).
const PROD_GEN_20260901: OperatingHoursGeneration[] = [
  { day_of_week: 1, open_time: '09:00', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null }, // 월
  { day_of_week: 2, open_time: '09:00', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null }, // 화
  { day_of_week: 3, open_time: '09:00', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null }, // 수
  { day_of_week: 4, open_time: '09:00', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null }, // 목
  { day_of_week: 5, open_time: '09:00', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null }, // 금
  { day_of_week: 6, open_time: '09:00', close_time: '19:00', last_booking_slot: '18:00', effective_from: '2026-09-01', effective_to: null }, // 토
  // 일(0) = 행 부재(row-absent · negative-space · DA Q4). is_closed 컬럼 없음.
];

// ── 격리 DB(obliv-foot-dev) 형상: 세대 테이블 미배포 ⇒ operating_hours=null ⇒ flat-fallback ⇒ 일요일 개방. ──
//   격리 DB clinics 실측: weekend_close_time '19:00'(EXCLUSIVE) → 일요일 flat 슬롯 10:00~18:30.
function makeIsolationClinic(): Clinic {
  return {
    id: '4478bdb0-54cd-4b04-b506-7d023ecbcdba', // DEV_ISOLATION_CLINIC_ID (obliv-foot-dev)
    open_time: '10:00',
    close_time: '20:30',
    weekend_close_time: '19:00', // 격리 DB 실측(EXCLUSIVE)
    slot_interval: SLOT_INTERVAL,
    operating_hours: null, // 세대 테이블 미배포 → flat-fallback
  } as unknown as Clinic;
}

// ── prod 형상: 09-01 세대 부착. ──
function makeProdClinic(): Clinic {
  return {
    id: '74967aea-a60b-4da3-a0e7-9c997a930bc8', // jongno-foot prod
    open_time: '10:00',
    close_time: '20:30',
    weekend_close_time: '18:30',
    slot_interval: SLOT_INTERVAL,
    operating_hours: PROD_GEN_20260901,
  } as unknown as Clinic;
}

// 로컬(Asia/Seoul 런타임) 캘린더 날짜 — TZ 드리프트 회피.
const D = (y: number, m: number, d: number) => new Date(y, m - 1, d);

// 검증용 일요일: 2026-09-06(일, 09-01 세대 커버 이후) / 2026-09-13(일).
const SUN_0906 = D(2026, 9, 6);
const SUN_0913 = D(2026, 9, 13);
// sanity: getDay()===0(일).
test('sanity: 검증 날짜가 실제 일요일(dow=0)인지', () => {
  expect(SUN_0906.getDay()).toBe(0);
  expect(SUN_0913.getDay()).toBe(0);
});

// ═══════════════════════════════════════════════════════════════════════════
// (A) AC-4 POST-VERIFY 3중 assertion — prod-shape (일요일 세대행 부재)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('(A) AC-4 HARD guard: prod 일요일 = 환자 미노출·부킹 차단', () => {
  const prod = makeProdClinic();

  test('A1: 환자 일요일 슬롯 미노출 — slotsForDate(일)=[] (09-01~)', () => {
    expect(slotsForDate(SUN_0906, prod)).toEqual([]);
    expect(slotsForDate(SUN_0913, prod)).toEqual([]);
  });

  test('A2: 환자 일요일 부킹 차단 무변 — isOpenDay(일)=false (휴무 row-absent)', () => {
    expect(isOpenDay(SUN_0906, prod)).toBe(false);
    expect(isOpenDay(SUN_0913, prod)).toBe(false);
    // slotWindowFor 는 isClosed=true 로 휴무 표현(is_closed 컬럼 없이).
    const w = slotWindowFor(SUN_0906, prod);
    expect(w.isClosed).toBe(true);
    expect(w.open).toBe('');
    expect(w.close).toBe('');
  });

  test('A3: 내부 테스트슬롯 인지 가능 — 격리 DB(flat-fallback) 일요일 개방', () => {
    const iso = makeIsolationClinic();
    // 테스터는 격리 DB 에서 일요일 슬롯을 확보한다(세대 테이블 미배포 → flat-fallback).
    expect(isOpenDay(SUN_0906, iso)).toBe(true);
    const isoSlots = slotsForDate(SUN_0906, iso);
    expect(isoSlots.length).toBeGreaterThan(0);
    expect(isoSlots[0]).toBe('10:00'); // flat open
    expect(isoSlots[isoSlots.length - 1]).toBe('18:30'); // weekend_close 19:00 EXCLUSIVE → 마지막 18:30
    // ★핵심: 동일 resolver·동일 코드가 환경(세대 배포 여부)에 따라 prod=휴무 / 격리=개방 을 산출.
    //   차별자 = operating_hours 세대의 존재/부재이지 is_closed 플래그가 아니다.
    expect(isOpenDay(SUN_0906, makeProdClinic())).toBe(false);
    expect(isOpenDay(SUN_0906, iso)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (B) 대칭 negative-space 증명 — is_closed / is_test(on operating_hours) 컬럼 불요
// ═══════════════════════════════════════════════════════════════════════════
test.describe('(B) 대칭 모델: 일요일 세대행 부재=휴무 ⟺ 존재=개방 (is_closed 없이)', () => {
  test('B1: 일요일 세대행 추가 시(가정) 개방 — 휴무는 오직 row-absent 로 표현', () => {
    // 만약 일요일 세대행이 존재하면(예: 격리/테스트 환경에서 세대 테이블을 배포하고 일요일 행을 넣는 경우)
    //   그 자체로 개방이 된다. 즉 '테스트슬롯'을 위해 is_closed=false 같은 별도 플래그가 필요 없다.
    const gensWithSunday: OperatingHoursGeneration[] = [
      ...PROD_GEN_20260901,
      { day_of_week: 0, open_time: '11:00', close_time: '17:00', last_booking_slot: '16:00', effective_from: '2026-09-01', effective_to: null }, // 일(테스트용)
    ];
    const clinicWithSun = { ...makeProdClinic(), operating_hours: gensWithSunday } as unknown as Clinic;
    expect(isOpenDay(SUN_0906, clinicWithSun)).toBe(true);
    const slots = slotsForDate(SUN_0906, clinicWithSun);
    expect(slots[0]).toBe('11:00');
    expect(slots[slots.length - 1]).toBe('16:00'); // last_booking_slot INCLUSIVE
    // 대칭: 같은 세대에서 일요일 행만 빼면 다시 휴무.
    const withoutSun = { ...makeProdClinic(), operating_hours: PROD_GEN_20260901 } as unknown as Clinic;
    expect(isOpenDay(SUN_0906, withoutSun)).toBe(false);
  });

  test('B2: resolver 는 is_closed/is_test 필드에 의존하지 않음 (그런 필드가 있어도 무시)', () => {
    // OperatingHoursGeneration 타입엔 is_closed/is_test 가 없다. 방어적으로 여분 필드를 주입해도
    //   resolver 결과는 오직 (day_of_week 행의 존재/부재 + open/last_booking_slot)로만 결정된다.
    // 스키마 외 필드(is_closed/is_test)를 방어적으로 주입 — resolver 가 이를 참조하지 않음을 증명(is_closed 축 부재).
    //   OperatingHoursGeneration 엔 없는 필드이나, 느슨한 객체 리터럴로 주입해 런타임 무시를 실증한다.
    const rowWithNoise = {
      day_of_week: 1, open_time: '09:00', close_time: '20:00', last_booking_slot: '19:00',
      effective_from: '2026-09-01', effective_to: null,
      is_closed: true, is_test: true,
    };
    const clinic = { ...makeProdClinic(), operating_hours: [rowWithNoise] } as unknown as Clinic;
    const MON_0907 = D(2026, 9, 7); // 월
    expect(MON_0907.getDay()).toBe(1);
    // is_closed:true 를 주입했지만 '행이 존재' → 개방(resolver 는 is_closed 무시).
    expect(isOpenDay(MON_0907, clinic)).toBe(true);
    expect(slotsForDate(MON_0907, clinic).length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (C) 무회귀 — prod 평일/토요일 동작 무변 (부모 OPHOURS-CHANGE-20260901 AC 유지)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('(C) 무회귀: prod 평일/토 동작 무변', () => {
  const prod = makeProdClinic();

  test('C1: 평일(화 2026-09-01) 마지막 슬롯 19:00 · 첫 09:00', () => {
    const slots = slotsForDate(D(2026, 9, 1), prod);
    expect(slots[0]).toBe('09:00');
    expect(slots[slots.length - 1]).toBe('19:00');
  });

  test('C2: 토요일(2026-09-05) 마지막 슬롯 18:00 · 개방', () => {
    const SAT = D(2026, 9, 5);
    expect(SAT.getDay()).toBe(6);
    expect(isOpenDay(SAT, prod)).toBe(true);
    const slots = slotsForDate(SAT, prod);
    expect(slots[slots.length - 1]).toBe('18:00');
  });

  test('C3: 09-01 이전 일요일(2026-08-30) = flat-fallback 개방(forward-only 무교란)', () => {
    const SUN_0830 = D(2026, 8, 30);
    expect(SUN_0830.getDay()).toBe(0);
    // 커버 세대 부재(effective_from 09-01 > 08-30) → flat-fallback → 개방(현행 동작 유지).
    expect(isOpenDay(SUN_0830, prod)).toBe(true);
  });
});
