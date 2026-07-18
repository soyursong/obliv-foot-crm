import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { generateSlots, RESV_TIME_GRID } from '../../src/lib/schedule';

/**
 * T-20260716-foot-TIMESLOT-RESCHEDULE-EMPTYDATE
 *   예약상세 팝업 예약캘린더 reschedule — 예약 0건 날짜(7/24·7/30)에서 시간 변경 불가 FIX.
 *
 * 근본 원인(responder DB·코드 실측 확정 = RCA superseded):
 *   ReservationDayTimeslotPanel 은 "선택 날짜에 이미 예약된 시간대"만 rows 로 fetch/표시.
 *   → 예약 0건 날짜 = slots.length===0 → 클릭 가능한 시간 행 0개 → reschedule 모드에서 onSelectTime 발화 불가.
 *
 * FIX(AC1): reschedule 모드(onSelectTime prop 有) + 예약 0건 날짜 → 운영시간 그리드(RESV_TIME_GRID)를
 *   count=0 클릭 가능 슬롯으로 렌더. 기존 예약 있는 날짜는 slots 그대로(AC2 회귀 가드).
 *   비-reschedule 조회 모드(selectable=false)는 기존 "예약 없음" 안내 유지(AC3 변경 대상 아님).
 *
 * 거대-established 컴포넌트(ReservationDayTimeslotPanel/ReservationDetailPopup) = source-integrity gating
 *   + 슬롯 그리드 순수 로직 단위검증. 실 브라우저 클릭 동선(시나리오 1/2)은 supervisor field-soak 로 닫음.
 */

const PANEL = fs.readFileSync(path.resolve('src/components/ReservationDayTimeslotPanel.tsx'), 'utf-8');
const DETAIL_POPUP = fs.readFileSync(path.resolve('src/components/ReservationDetailPopup.tsx'), 'utf-8');

// ── AC1: 운영시간 그리드 SSOT (순수 로직)
test.describe('AC1 — RESV_TIME_GRID 운영시간 그리드 SSOT', () => {
  test('RESV_TIME_GRID = generateSlots(07:00, 22:00, 30) — 하드코딩 아닌 schedule.ts 파생', () => {
    expect(RESV_TIME_GRID).toEqual(generateSlots('07:00', '22:00', 30));
  });

  test('그리드 값 불변(회귀 가드) — 07:00 시작, 21:30 종료, 30분 간격 30개', () => {
    expect(RESV_TIME_GRID.length).toBe(30);
    expect(RESV_TIME_GRID[0]).toBe('07:00');
    expect(RESV_TIME_GRID[RESV_TIME_GRID.length - 1]).toBe('21:30');
    // 30분 정규 간격 — 임의 중간값 검증
    expect(RESV_TIME_GRID).toContain('10:00');
    expect(RESV_TIME_GRID).toContain('20:00');
    expect(RESV_TIME_GRID).toContain('14:30');
  });
});

// ── AC1: 패널 — reschedule 모드 + 예약 0건 날짜 → 운영시간 슬롯 렌더(클릭 가능)
test.describe('AC1 패널 — 빈 날짜 reschedule 시 운영시간 그리드 렌더', () => {
  test('패널이 schedule.ts RESV_TIME_GRID 를 재사용(자체 슬롯 하드코딩 금지)', () => {
    expect(PANEL).toContain("from '@/lib/schedule'");
    expect(PANEL).toContain('RESV_TIME_GRID');
    // 패널 내부에 07:00~22:00 같은 슬롯 시각 리터럴 하드코딩 없음(그리드는 schedule.ts SSOT 위임)
    expect(PANEL).not.toContain("generateSlots('07:00'");
  });

  test('reschedule 모드(selectable) + slots.length===0 일 때만 그리드 렌더 — emptyReschedule 게이트', () => {
    expect(PANEL).toContain('const emptyReschedule = selectable && slots.length === 0');
    // 그리드는 count 전부 0(EMPTY_SLOT_COUNTS)으로 매핑 → 클릭 가능 행
    expect(PANEL).toContain('EMPTY_SLOT_COUNTS');
    expect(PANEL).toContain('RESV_TIME_GRID.map((time) => ({ time, counts: EMPTY_SLOT_COUNTS }))');
    // 렌더는 displaySlots 사용(빈날짜=그리드 / 그 외=slots)
    expect(PANEL).toContain('displaySlots');
  });

  test('EMPTY_SLOT_COUNTS = 모든 유형 0 (초/재/힐러/기타/총 0)', () => {
    // 패널 상수 정의가 SlotKindCount 전 필드 0 인지 소스 확인
    expect(PANEL).toContain('const EMPTY_SLOT_COUNTS: SlotKindCount = { n: 0, r: 0, h: 0, o: 0, total: 0 }');
  });

  test('빈 날짜 그리드에 안내 힌트 + 클릭 가능 행(TimeslotLine onSelect) 렌더', () => {
    expect(PANEL).toContain('popup-timeslot-emptyday-hint');
    expect(PANEL).toContain('data-empty-grid');
    // 클릭 가능은 기존 selectable 경로(onSelect) 그대로 — TimeslotLine 이 button 렌더
    expect(PANEL).toContain('onSelect={selectable ? () => onSelectTime!(time) : undefined}');
  });
});

// ── AC2: 기존 예약 있는 날짜 회귀 가드 (동작 불변)
test.describe('AC2 회귀 — 기존 예약 있는 날짜는 slots 그대로', () => {
  test('slots.length>0 이면 displaySlots=slots (그리드 미개입)', () => {
    // emptyReschedule 은 slots.length===0 에서만 true → 예약 있는 날짜는 항상 slots 렌더
    expect(PANEL).toContain('? RESV_TIME_GRID.map((time) => ({ time, counts: EMPTY_SLOT_COUNTS }))');
    expect(PANEL).toContain(': slots;');
  });

  test('패널은 여전히 read-only — DB write(insert/update/delete) 경로 없음(GUARD)', () => {
    expect(PANEL).toContain("from('reservations')");
    expect(PANEL).toContain('.select(');
    expect(PANEL).not.toContain('.insert(');
    expect(PANEL).not.toContain('.update(');
    expect(PANEL).not.toContain('.delete(');
  });

  test('집계 lib(resvSlotAgg) 재사용 유지 — 자체 집계 재구현 없음', () => {
    expect(PANEL).toContain("from '@/lib/resvSlotAgg'");
    expect(PANEL).toContain('aggregateByTimeSlot');
  });
});

// ── AC3: 비-reschedule 조회 모드 불변
test.describe('AC3 — 비-reschedule(조회) 모드는 기존 "예약 없음" 안내 유지', () => {
  test('selectable=false + 빈 날짜 → "이 날짜에 예약이 없습니다" 안내 보존', () => {
    // displaySlots 가 빈 경우(=비-reschedule + slots 0)에만 안내 표시
    expect(PANEL).toContain('displaySlots.length === 0');
    expect(PANEL).toContain('이 날짜에 예약이 없습니다.');
  });
});

// ── 회귀: 신규예약 폼도 동일 그리드(RESV_TIME_GRID) SSOT 공유
test.describe('회귀 — 신규예약 폼 슬롯 그리드 SSOT 통일', () => {
  test('팝업 NEW_RESV_TIME_SLOTS = RESV_TIME_GRID (값 동일, 하드코딩 리터럴 제거)', () => {
    expect(DETAIL_POPUP).toContain("import { RESV_TIME_GRID } from '@/lib/schedule'");
    expect(DETAIL_POPUP).toContain('const NEW_RESV_TIME_SLOTS = RESV_TIME_GRID');
    // 구 하드코딩 그리드 생성 리터럴 제거됨
    expect(DETAIL_POPUP).not.toContain("generateSlots('07:00', '22:00', 30)");
  });

  test('팝업이 anchor 예약에 reschedule wire-in 유지(onSelectTime→setSelectedSlotTime)', () => {
    expect(DETAIL_POPUP).toContain('onSelectTime={loadedMatch ? undefined : setSelectedSlotTime}');
    expect(DETAIL_POPUP).toContain('data-testid="btn-reschedule-time"');
  });
});
