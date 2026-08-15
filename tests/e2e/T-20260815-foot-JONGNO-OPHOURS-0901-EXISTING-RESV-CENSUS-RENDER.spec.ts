import { test, expect } from '@playwright/test';
import { slotsForDate, isOpenDay } from '../../src/lib/schedule';
import type { Clinic, OperatingHoursGeneration } from '../../src/lib/types';

/**
 * T-20260815-foot-JONGNO-OPHOURS-0901-EXISTING-RESV-CENSUS-RENDER — 렌더 회귀 보정 self-test (AC-4).
 *
 * 발주: CEO 조종실 FOLLOWUP(MSG-20260815-174007-fa1q). 부모 T-...-CHANGE-20260901 apply(17:06:34) 후 라이브.
 *
 * 문제(② 렌더 회귀): 09-01 운영창 축소(평일 마지막슬롯 19:00 / 토 18:00 / 일 휴무·슬롯0)로,
 *   운영창 밖(평일 19:30·20:00 / 토 18:30 / 일 전건) "기존 예약"이 신규예약 슬롯(slotsForDate/gridSlots)
 *   밖으로 밀려나 타임라인 행 자체가 안 생겨 화면에서 사라진다(스태프 미인지 → 노쇼/이중예약).
 *
 * 보정(AC-4): 표시축(renderSlots = 운영창 슬롯 ∪ 실 예약 시각) ⊥ 신규예약 차단축(slotsForDate/allowed) 분리.
 *   · Dashboard.tsx  renderSlots: 기존 일요일 한정 pass-through 를 전 요일로 일반화(slots ∪ Object.keys(slotMap)).
 *   · Reservations.tsx renderSlots: gridSlots ∪ 현재 뷰 실 예약 시각(취소 제외). tbody 행 소스로 사용.
 *   두 화면 모두 신규예약 가능 여부(slotsForDate / allowed=slotsFor(d).includes(time))는 불변 → 부모 AC-1/AC-4 무저촉.
 *
 * ★검증 대상 = (1) 신규예약 차단축(순수 resolver) 불변 + (2) 표시-병합 불변식(renderSlots 로직 미러) +
 *   (3) 두 컴포넌트 소스가드(회귀 봉인). 실 DB census(①)·실 렌더 실측(②)은 supervisor/planner POST-VERIFY 소관.
 *   본 spec 은 코드 자산의 논리 정합만 봉인한다(READ-ONLY, DB 무접촉 · AC-3 파괴 0).
 */

const SLOT_INTERVAL = 30;

// 2026-09-01 발효 세대(jongno seed 미러). 일(dow 0) = 행 부재(휴무).
const GEN_20260901: OperatingHoursGeneration[] = [
  { day_of_week: 1, open_time: '09:00', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null },
  { day_of_week: 2, open_time: '09:00', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null },
  { day_of_week: 3, open_time: '09:00', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null },
  { day_of_week: 4, open_time: '09:00', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null },
  { day_of_week: 5, open_time: '09:00', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null },
  { day_of_week: 6, open_time: '09:00', close_time: '19:00', last_booking_slot: '18:00', effective_from: '2026-09-01', effective_to: null },
];

function makeClinic(): Clinic {
  return {
    id: '74967aea-a60b-4da3-a0e7-9c997a930bc8',
    open_time: '10:00',
    close_time: '20:30',
    weekend_close_time: '18:30',
    slot_interval: SLOT_INTERVAL,
    operating_hours: GEN_20260901,
  } as unknown as Clinic;
}

const D = (y: number, m: number, d: number) => new Date(y, m - 1, d);

/**
 * 표시-병합 불변식 미러 — 두 컴포넌트 renderSlots 산출과 동형.
 *   Dashboard: Array.from(new Set([...slots, ...Object.keys(slotMap)])).sort()
 *   Reservations: Array.from(new Set([...gridSlots, ...occupied])).sort()
 */
function mergeRenderSlots(displaySlots: string[], occupiedTimes: string[]): string[] {
  return Array.from(new Set([...displaySlots, ...occupiedTimes])).sort();
}

// ═══════════════════════════════════════════════════════════════════════════
// T1 — 신규예약 차단축(slotsForDate) 불변: 운영창 밖 시각은 여전히 신규예약 슬롯 아님 (부모 AC-1/AC-4 무저촉)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('T1: 신규예약 차단축 불변 (표시 보정이 차단을 되돌리지 않음)', () => {
  const clinic = makeClinic();

  test('T1-1: 평일(화 09-01) 신규예약 슬롯에 19:30·20:00 없음(차단 유지)', () => {
    const slots = slotsForDate(D(2026, 9, 1), clinic);
    expect(slots).not.toContain('19:30');
    expect(slots).not.toContain('20:00');
    expect(slots[slots.length - 1]).toBe('19:00');
  });

  test('T1-2: 토(09-05) 신규예약 슬롯에 18:30 없음(차단 유지)', () => {
    const slots = slotsForDate(D(2026, 9, 5), clinic);
    expect(slots).not.toContain('18:30');
    expect(slots[slots.length - 1]).toBe('18:00');
  });

  test('T1-3: 일(09-06) 휴무 = 신규예약 슬롯 0 + isOpenDay=false(차단 유지)', () => {
    const sunday = D(2026, 9, 6);
    expect(slotsForDate(sunday, clinic)).toEqual([]);
    expect(isOpenDay(sunday, clinic)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T2 — 표시축(renderSlots 병합)이 운영창 밖 "기존 예약" 시각을 반드시 포함 (AC-2 카테고리별)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('T2: 표시축 병합 — 운영창 밖 기존 예약이 렌더 슬롯에 등장', () => {
  const clinic = makeClinic();

  test('T2-1: 평일(화 09-01) 19:30·20:00 기존 예약 → renderSlots 포함(표시)', () => {
    const slots = slotsForDate(D(2026, 9, 1), clinic); // 신규예약 차단축(09:00~19:00)
    const occupied = ['19:30', '20:00'];               // 운영창 밖 기존 예약 실시각
    const render = mergeRenderSlots(slots, occupied);
    expect(render).toContain('19:30'); // 사라지지 않고 표시됨
    expect(render).toContain('20:00');
    expect(render).toContain('19:00'); // 운영창 내 슬롯도 유지
    // 정렬 불변식: 마지막 표시행 = 20:00 (기존 예약이 그리드 하단에 노출)
    expect(render[render.length - 1]).toBe('20:00');
  });

  test('T2-2: 토(09-05) 18:30 기존 예약 → renderSlots 포함(표시)', () => {
    const slots = slotsForDate(D(2026, 9, 5), clinic);
    const render = mergeRenderSlots(slots, ['18:30']);
    expect(render).toContain('18:30');
    expect(render[render.length - 1]).toBe('18:30');
  });

  test('T2-3: 일(09-06 휴무·슬롯0) 기존 예약 → renderSlots 에 그대로 표시 (최고위험 케이스)', () => {
    const slots = slotsForDate(D(2026, 9, 6), clinic); // [] (휴무)
    expect(slots).toEqual([]);
    const occupied = ['14:00', '16:30'];               // 휴무일 기존 예약(재조정 대상)
    const render = mergeRenderSlots(slots, occupied);
    // 슬롯 0 이어도 기존 예약 시각은 표시행으로 살아남는다(스태프 인지 → 노쇼/이중예약 방지)
    expect(render).toEqual(['14:00', '16:30']);
  });

  test('T2-4: 운영창 내 기존 예약만 있으면 renderSlots == 신규예약 슬롯 (무회귀)', () => {
    const slots = slotsForDate(D(2026, 9, 1), clinic);
    const render = mergeRenderSlots(slots, ['10:00', '14:30']); // 전부 운영창 내
    expect(render).toEqual(slots); // 병합해도 변화 없음(정상일 무회귀)
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T3 — 소스가드: 두 컴포넌트 렌더 회귀 봉인 (일요일 한정 pass-through → 전 요일 일반화 / tbody 행 소스)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('T3: 컴포넌트 소스가드 (렌더 회귀 재발 방지)', () => {
  test('T3-1: Dashboard.tsx renderSlots 는 isSunday 로 게이트되지 않음(전 요일 병합)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.resolve('src/pages/Dashboard.tsx'), 'utf-8');
    // renderSlots 는 무조건 slots ∪ slotMap 병합 (isSunday 삼항 제거)
    expect(/const renderSlots = Array\.from\(new Set\(\[\.\.\.slots, \.\.\.Object\.keys\(slotMap\)\]\)\)\.sort\(\);/.test(src)).toBe(true);
    expect(/const renderSlots = isSunday/.test(src)).toBe(false); // 구 일요일-한정 게이트 부재
  });

  test('T3-2: Reservations.tsx tbody 행 소스 = renderSlots (gridSlots 직접 map 아님)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');
    expect(/renderSlots\.map\(/.test(src)).toBe(true);      // tbody 는 renderSlots 순회
    expect(/const renderSlots = useMemo\(/.test(src)).toBe(true); // renderSlots 정의 존재
    // 신규예약 차단축(allowed=slotsFor(d).includes(time))은 여전히 존재(표시축과 분리 유지)
    expect(/slotsFor\(d\)\.includes\(time\)/.test(src)).toBe(true);
  });
});
