import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { aggregateByTimeSlot, resvKind } from '../../src/lib/resvSlotAgg';

/**
 * T-20260614-foot-RESVPOPUP-TIMESLOT-PICKER — 예약상세팝업 미니캘린더 시간대 현황 + 시간 선택
 * 원천: 김주연 총괄(C0ATE5P6JTH, thread 1781363465.507899).
 *
 * 본 커밋 범위 = AC1 read-only 시간대별 예약현황 패널 scaffolding (field_clarify_pending=true).
 *   - AC1: 미니캘린더 날짜클릭(pickedDate) → 해당 일자 시간대별 초/재/힐러 카운트 표시(read-only).
 *   - 집계 = RESVCAL-DISPLAY-REWORK item2 슬롯집계 로직 재사용(@/lib/resvSlotAgg, 중복 구현 금지).
 *   - 총계 = HL(힐러) 합산 포함(RESVCAL-FOLLOWUP-5FIX nji4 superseded 규칙).
 *
 * 보류(field clarify 답변 대기 — 본 커밋 미구현, test.fixme):
 *   - AC2 시간 선택(reservations 시간 update write) = spec Q3.
 *   - Q2 마감 표시(시간대 최대 인원 기준) = spec Q2.
 *
 * GUARD: 예약경로 write 입력란 신설 금지 / 우클릭 진입점 불변 / 미니캘린더 재작성 금지(확장만).
 * 거대-established 컴포넌트(ReservationDetailPopup) = source-integrity gating + 순수 집계로직 단위검증.
 * 실 브라우저 동작은 supervisor field-soak 로 닫음.
 */

const DETAIL_POPUP = fs.readFileSync(path.resolve('src/components/ReservationDetailPopup.tsx'), 'utf-8');
const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');
const PANEL = fs.readFileSync(path.resolve('src/components/ReservationDayTimeslotPanel.tsx'), 'utf-8');

// ── 시나리오 1 (AC1): 시간대 현황 표시 — 집계 로직 단위검증 (순수 함수)
test.describe('AC1 집계 로직 — RESVCAL item2 슬롯집계 재사용(중복 구현 금지)', () => {
  test('resvKind: 힐러(healer_flag) 우선 → 초진 → 재진 → 기타', () => {
    expect(resvKind({ healer_flag: true, visit_type: 'new' })).toBe('healer'); // 힐러 우선
    expect(resvKind({ healer_flag: false, visit_type: 'new' })).toBe('new');
    expect(resvKind({ visit_type: 'returning' })).toBe('returning');
    expect(resvKind({ visit_type: 'experience' })).toBe('other'); // 선체험 = 기타
  });

  test('aggregateByTimeSlot: 시간대별 초/재/힐러 카운트 + 취소 제외 + HL 합산 총계', () => {
    const rows = [
      { reservation_time: '10:00:00', visit_type: 'new', healer_flag: false, status: 'confirmed' as const },
      { reservation_time: '10:00:00', visit_type: 'new', healer_flag: false, status: 'confirmed' as const },
      { reservation_time: '10:00:00', visit_type: 'returning', healer_flag: false, status: 'checked_in' as const },
      { reservation_time: '10:00:00', visit_type: 'returning', healer_flag: false, status: 'confirmed' as const },
      { reservation_time: '10:00:00', visit_type: 'returning', healer_flag: false, status: 'confirmed' as const },
      { reservation_time: '10:00:00', visit_type: 'returning', healer_flag: true, status: 'confirmed' as const }, // 힐러
      { reservation_time: '10:00:00', visit_type: 'new', healer_flag: false, status: 'cancelled' as const }, // 제외
      { reservation_time: '11:30:00', visit_type: 'new', healer_flag: false, status: 'confirmed' as const },
    ];
    const out = aggregateByTimeSlot(rows);
    // 시간 오름차순
    expect(out.map((s) => s.time)).toEqual(['10:00', '11:30']);
    // 10:00 — 초진 2 / 재진 3 / 힐러 1, 취소 1건 제외, 총 6 (HL 합산 포함)
    expect(out[0].counts).toEqual({ n: 2, r: 3, h: 1, o: 0, total: 6 });
    // 11:30 — 초진 1
    expect(out[1].counts).toEqual({ n: 1, r: 0, h: 0, o: 0, total: 1 });
  });

  test('빈 입력/전체 취소 → 빈 배열', () => {
    expect(aggregateByTimeSlot([])).toEqual([]);
    expect(
      aggregateByTimeSlot([
        { reservation_time: '09:00:00', visit_type: 'new', healer_flag: false, status: 'cancelled' },
      ]),
    ).toEqual([]);
  });
});

// ── 시나리오 1 (AC1): 패널 wire-in (source-integrity)
test.describe('AC1 패널 wire-in — 미니캘린더 날짜클릭 → 시간대 현황(read-only)', () => {
  test('패널이 공유 집계 lib(resvSlotAgg)를 재사용 — 자체 집계 구현 금지', () => {
    expect(PANEL).toContain("from '@/lib/resvSlotAgg'");
    expect(PANEL).toContain('aggregateByTimeSlot');
    // 패널 내부에 healer_flag 분류/카운트 로직 재구현 없음(lib 위임)
    expect(PANEL).not.toContain('healer_flag) return');
  });

  test('패널은 read-only — reservations write(insert/update) 경로 없음(GUARD)', () => {
    expect(PANEL).toContain("from('reservations')");
    expect(PANEL).toContain('.select(');
    expect(PANEL).not.toContain('.insert(');
    expect(PANEL).not.toContain('.update(');
    expect(PANEL).not.toContain('.delete(');
  });

  test('패널이 지점 스코프(clinic_id) + 선택일자(reservation_date)로 조회', () => {
    expect(PANEL).toContain(".eq('clinic_id', clinicId)");
    expect(PANEL).toContain(".eq('reservation_date', dateStr)");
  });

  test('팝업이 미니캘린더 아래에 시간대 패널을 pickedDate 로 wire-in', () => {
    expect(DETAIL_POPUP).toContain("from '@/components/ReservationDayTimeslotPanel'");
    expect(DETAIL_POPUP).toContain('<ReservationDayTimeslotPanel');
    expect(DETAIL_POPUP).toContain('date={pickedDate}');
    expect(DETAIL_POPUP).toContain('clinicId={reservation.clinic_id}');
    // 미니캘린더 → 시간대 패널 순서(캘린더 아래)
    const calIdx = DETAIL_POPUP.indexOf('<MiniMonthCalendar');
    const panelIdx = DETAIL_POPUP.indexOf('<ReservationDayTimeslotPanel');
    expect(calIdx).toBeGreaterThan(-1);
    expect(panelIdx).toBeGreaterThan(calIdx);
  });

  test('GUARD: 미니캘린더 재작성 금지 — 기존 MiniMonthCalendar 컴포넌트 그대로 사용', () => {
    expect(DETAIL_POPUP).toContain("from '@/components/MiniMonthCalendar'");
    expect(DETAIL_POPUP).toContain('<MiniMonthCalendar');
  });
});

// ── 회귀: resvKind 단일 소스화(중복 구현 금지)
test.describe('회귀 — resvKind 단일 소스(주간 캘린더 + 팝업 패널 공유)', () => {
  test('Reservations.tsx 가 공유 lib resvKind 를 import — 로컬 재정의 제거', () => {
    expect(RESV_PAGE).toContain("from '@/lib/resvSlotAgg'");
    // 로컬 function resvKind 정의가 제거됨(import 만 존재)
    expect(RESV_PAGE).not.toContain('function resvKind(');
  });
});

// ── 시나리오 2 (AC2): 시간 선택 write — field clarify(Q3) 답변 대기, 본 커밋 미구현
test.describe('AC2 시간 선택(write) — field clarify Q3 답변 대기', () => {
  test.fixme('AC2: 시간대 클릭 → reservations 시간 update (Q3 = 저장 확정 후 구현)', () => {
    // spec Q3(선택 시간이 reservations 시간 저장인지 단순 선택 UI인지) 답변 후 구현.
  });
  test.fixme('Q2: 시간대 최대 인원 기준 마감 표시 (Q2 답변 후 구현)', () => {
    // spec Q2(마감 표시 포함 여부 + 최대 인원 기준) 답변 후 구현.
  });
});
