import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260708-foot-DASH-TIMETABLE-RESV-BROKEN-QUICKADD-DISABLE
 * 원천: 김주연 총괄(C0ATE5P6JTH) — 동일 신고 3회 재접수(gon4/po0v/hepm) → P1.
 *
 * AC1 (버그): 통합시간표에서 즉석 생성한 예약건 차트 미오픈 + 예약관리 고객박스 클릭 무반응.
 *   RC = 예약관리(Reservations.tsx) 고객박스 plain-span onClick 의 `if (!r.customer_id) return;`
 *        조기반환이 미연결(customer_id=null, 대시보드 워크인 생성건) 클릭을 silent no-op(무반응)으로 만듦.
 *   Fix = 조기반환 제거 → 항상 handleResvOpenChart 위임(미연결=안내 토스트=정상 반응 / 연결=차트 오픈).
 *
 * AC2 (정책): 대시보드 통합시간표 신규예약 생성 진입점([빠른 예약 추가] 모달) 차단 + 당일 시간변동 보존.
 *   Fix = DashboardTimeline onSlotClick 미전달(dashResvCreateDisabled=true) → 빈 슬롯 클릭 생성 비활성.
 *        드롭(시간변동/리스케줄)은 SlotDropCell useDroppable 로 독립 → 보존(핵심 회귀 항목).
 *        예약관리 등 다른 surface 신규생성은 스코프 밖(불변).
 *
 * 거대-인라인 컴포넌트(Dashboard.tsx/Reservations.tsx) 관례 = source-integrity gating(정적 소스 단언)으로
 * 회귀 차단. 실 브라우저 동작은 supervisor field-soak(갤탭 실기기)로 닫음. DB 무관(FE-only, 스키마 0).
 */

const DASH = fs.readFileSync(path.resolve('src/pages/Dashboard.tsx'), 'utf-8');
const RESV = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 1·2 (AC1) — 예약관리 고객박스 무반응 제거(dead-click RC)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC1: 예약관리 고객박스 클릭 정상 반응 (무반응 RC 제거)', () => {
  test('AC1-1: 고객박스 onClick 의 `if (!r.customer_id) return;` 조기반환 제거', () => {
    // dead-click no-op 근원. 코드에서 완전 소거되어야 함(주석 언급은 허용하되 실행 라인 0).
    const executableGuards = RESV
      .split('\n')
      .filter((l) => /if\s*\(!r\.customer_id\)\s*return;/.test(l) && !l.trimStart().startsWith('//'));
    expect(executableGuards, `고객박스 dead-click 가드가 아직 실행 라인에 남아있음:\n${executableGuards.join('\n')}`)
      .toHaveLength(0);
  });

  test('AC1-2: 미연결(customer_id=null) 클릭도 handleResvOpenChart 로 위임 → 정상 반응', () => {
    // handleResvOpenChart 는 null 을 안내 토스트로 graceful 처리(무반응 아님).
    expect(RESV, 'handleResvOpenChart 미연결 graceful 처리 라인 소실')
      .toContain("if (!ci.customer_id) { toast.info('고객 정보가 연결되어 있지 않습니다'); return; }");
    // 두 뷰(일간 TIMEGRID / 주간)의 고객박스 span 이 handleResvOpenChart(resvAsCheckIn(r)) 로 배선.
    const wired = RESV.match(/handleResvOpenChart\(resvAsCheckIn\(r\)\)/g) ?? [];
    expect(wired.length, 'handleResvOpenChart(resvAsCheckIn(r)) 배선 개수 부족(일간+주간 고객박스)')
      .toBeGreaterThanOrEqual(3);
  });

  test('AC1-3: 본 티켓 RC 마킹이 소스에 명시', () => {
    expect(RESV).toContain('T-20260708-foot-DASH-TIMETABLE-RESV-BROKEN-QUICKADD-DISABLE (AC1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 3 (AC2) — 대시보드 신규예약 생성 진입점 차단
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC2: 대시보드 통합시간표 신규예약 생성 차단', () => {
  test('AC2-1: dashResvCreateDisabled 정책 플래그 true', () => {
    expect(DASH, 'dashResvCreateDisabled 정책 플래그 부재').toContain('const dashResvCreateDisabled = true;');
  });

  test('AC2-2: onSlotClick 이 정책 플래그로 게이팅(비활성 시 undefined)', () => {
    expect(DASH, 'onSlotClick 게이팅 배선 부재')
      .toContain('onSlotClick={dashResvCreateDisabled ? undefined : handleQuickSlotClick}');
  });

  test('AC2-3: SlotDropCell 생성 onClick 이 onSlotClick 유무로 조건부(미전달 시 no create)', () => {
    // 빈 슬롯 클릭 생성은 onSlotClick 이 있을 때만 발화 — undefined 면 생성 진입점 죽음.
    expect(DASH).toContain('onClick={onSlotClick ? () => onSlotClick({ date: dateStr, time: slot }) : undefined}');
    expect(DASH).toContain("onClick={onSlotClick ? () => onSlotClick({ date: dateStr, time: slot, visit_type: 'returning' }) : undefined}");
  });

  test('AC2-4: onSlotClick prop 이 optional(미전달 허용)', () => {
    expect(DASH).toContain('onSlotClick?: (slot: { date: string; time: string; visit_type?: VisitType }) => void;');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 4 (AC2 핵심 회귀) — 당일 시간변동(드롭 리스케줄) 보존
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC2 회귀 방지: 당일 시간변동(드롭) 보존', () => {
  test('AC2-5: SlotDropCell 드롭(useDroppable)은 onClick 과 독립 → 생성 차단이 시간변동을 죽이지 않음', () => {
    // SlotDropCell 내부 드롭 배선(useDroppable)이 유지되어야 함 — 생성 onClick 과 별개 경로.
    expect(DASH, 'SlotDropCell useDroppable(드롭=시간변동) 배선 소실').toContain('const { isOver, setNodeRef } = useDroppable({ id: slotId });');
    // 두 컬럼(초진/재진) 드롭 셀 slotId 유지.
    expect(DASH).toContain('slotId={`timeslot-new:${slot}`}');
    expect(DASH).toContain('slotId={`timeslot-ret:${slot}`}');
  });

  test('AC2-6: 생성 폐지 코드는 보존(정책 해제 시 복구 가능) — handleQuickSlotClick·QuickReservationDialog 잔존', () => {
    expect(DASH, 'handleQuickSlotClick 소실(정책 해제 복구 불가)').toContain('const handleQuickSlotClick =');
    expect(DASH, 'QuickReservationDialog 컴포넌트 소실').toContain('function QuickReservationDialog(');
  });

  test('AC2-7: 예약관리 등 다른 surface 신규생성 진입점 불변(스코프 밖) — Reservations.tsx 미개입', () => {
    // 본 커밋의 Reservations 변경은 AC1(고객박스 dead-click)만. 신규생성 경로 게이팅 문구가 섞이면 스코프 이탈.
    expect(RESV, 'AC2 생성차단이 예약관리 surface 로 번짐(스코프 위반)').not.toContain('dashResvCreateDisabled');
  });
});
