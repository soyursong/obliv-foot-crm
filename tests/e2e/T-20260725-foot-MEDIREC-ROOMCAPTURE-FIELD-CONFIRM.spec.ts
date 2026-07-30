/**
 * T-20260725-foot-MEDIREC-ROOMCAPTURE-FIELD-CONFIRM — 풋 상담 room_id 캡처 + 60일 백필
 *
 * 배경: status_transitions.room_id(TEXT, nullable) 존재하나 全 INSERT site 미기입 → 0%.
 *   메디렉 상담실 녹취 ↔ CRM 현장동선 조인 앵커가 비어 全 미귀속. (A) 코드픽스로 해소.
 *
 * 스코프(ADDITIVE·계약 무변경·DDL 0):
 *   ① 캡처: 룸수반 status_transition INSERT(방 드롭·상담실/치료실/레이저실 배정)에 room_id 주입.
 *      소스 = 동시 기입되는 check_in_room_logs.assigned_room 와 동일한 방 라벨(FE scope 내).
 *   ② 미수반 전이 NULL 유지: registered/_waiting/returning_zone/checklist/exam_waiting/receiving
 *      + RPC(셀프접수·프리스크린·건강문진) = 자연 NULL(스키마 NOT NULL 제약 걸지 않음).
 *   ③ 60일 백필: 과거 룸수반 전이 room_id 를 check_in_room_logs 에서 시간최근접(±5분) 결정적 소급.
 *
 * 본 spec 은 브라우저/DB 불필요 순수 로직 회귀 가드(기존 CHART2-DWELL-ROOMNUM spec 동형):
 *   AC-1: 룸수반 to_status 만 room_id 캡처 대상, 미수반은 NULL(캡처 결정 로직).
 *   AC-2: 백필 nearest-log 해석 — room_type 매핑 + ±5분 window + 시간최근접 결정적 tie-break.
 *   AC-3: 매칭 로그 부재 시 NULL 유지(강제귀속 금지, 귀속불가 잔차).
 */
import { test, expect } from '@playwright/test';

// ── 캡처 결정 로직 재현 (Dashboard.tsx 룸수반 전이 판정과 동형) ──
// 룸수반 to_status = 방 필드를 갖는 전이. 이 전이의 INSERT 에만 room_id 주입.
const ROOM_ACCOMPANYING_STATUSES = new Set([
  'consultation',    // 상담실 (consultation_room)
  'preconditioning', // 치료실 (treatment_room)
  'laser',           // 레이저실 (laser_room)
  'heated_laser',    // (레거시) 레이저실
  'examination',     // 진료실 (examination_room)
]);

/** 룸수반 전이면 방 라벨을 캡처, 아니면 null(자연 NULL). */
function captureRoomId(toStatus: string, roomLabelInScope: string | null): string | null {
  if (!ROOM_ACCOMPANYING_STATUSES.has(toStatus)) return null; // 미수반 → NULL
  return roomLabelInScope; // 룸수반 → scope 내 방 라벨(= check_in_room_logs.assigned_room)
}

// ── 백필 nearest-log 해석 재현 (backfill .sql LATERAL join 과 동형) ──
const BACKFILL_STATUS_TO_ROOM_TYPE: Record<string, string> = {
  consultation: 'consultation',
  preconditioning: 'treatment',
  laser: 'laser',
  heated_laser: 'laser',
  examination: 'examination',
};
const BACKFILL_WINDOW_SEC = 300; // ±5분

interface RoomLog { assigned_room: string; room_type: string; logged_at: string }

/** transitioned_at 최근접(±5분) assigned_room 결정적 선택. 매칭 없으면 null. */
function backfillResolveRoom(toStatus: string, transitionedAt: string, logs: RoomLog[]): string | null {
  const rt = BACKFILL_STATUS_TO_ROOM_TYPE[toStatus];
  if (!rt) return null;
  const tAt = new Date(transitionedAt).getTime();
  const cand = logs
    .filter((l) => l.room_type === rt)
    .map((l) => ({ l, gap: Math.abs(new Date(l.logged_at).getTime() - tAt) }))
    .filter((x) => x.gap <= BACKFILL_WINDOW_SEC * 1000)
    // 결정적 정렬: gap ASC, logged_at ASC, assigned_room ASC
    .sort((a, b) =>
      a.gap - b.gap ||
      new Date(a.l.logged_at).getTime() - new Date(b.l.logged_at).getTime() ||
      a.l.assigned_room.localeCompare(b.l.assigned_room));
  return cand.length ? cand[0].l.assigned_room : null;
}

// ══════════════════════════════════════════════════════════════════════
test.describe('T-20260725 room_id 캡처 결정 로직 (AC-1)', () => {
  test('룸수반 전이는 방 라벨 캡처', () => {
    expect(captureRoomId('consultation', '상담실1')).toBe('상담실1');
    expect(captureRoomId('preconditioning', 'C9')).toBe('C9');
    expect(captureRoomId('laser', 'L2')).toBe('L2');
    expect(captureRoomId('examination', '진료실1')).toBe('진료실1');
    expect(captureRoomId('heated_laser', 'L1')).toBe('L1');
  });

  test('미수반 전이는 NULL 유지 (스키마 NOT NULL 걸지 않음)', () => {
    for (const s of ['registered', 'consult_waiting', 'treatment_waiting', 'laser_waiting',
      'healer_waiting', 'exam_waiting', 'receiving', 'checklist', 'payment_waiting', 'done', 'cancelled']) {
      expect(captureRoomId(s, 'C9')).toBeNull(); // 방 라벨이 scope 에 있어도 미수반이면 캡처 안 함
    }
  });
});

test.describe('T-20260725 백필 nearest-log 결정적 해석 (AC-2/AC-3)', () => {
  const logs: RoomLog[] = [
    { assigned_room: '상담실1', room_type: 'consultation', logged_at: '2026-07-01T01:00:00Z' },
    { assigned_room: '상담실2', room_type: 'consultation', logged_at: '2026-07-01T01:03:30Z' },
    { assigned_room: 'C9', room_type: 'treatment', logged_at: '2026-07-01T02:00:10Z' },
    { assigned_room: 'L2', room_type: 'laser', logged_at: '2026-07-01T03:00:00Z' },
  ];

  test('AC-2: 상담 전이 → 시간최근접 상담 로그', () => {
    // 01:01:00 전이 → 상담실1(gap 60s) vs 상담실2(gap 150s) → 최근접 상담실1
    expect(backfillResolveRoom('consultation', '2026-07-01T01:01:00Z', logs)).toBe('상담실1');
    // 01:03:00 전이 → 상담실2(gap 30s) 최근접
    expect(backfillResolveRoom('consultation', '2026-07-01T01:03:00Z', logs)).toBe('상담실2');
  });

  test('AC-2: room_type 매핑 — preconditioning→treatment, laser→laser', () => {
    expect(backfillResolveRoom('preconditioning', '2026-07-01T02:00:00Z', logs)).toBe('C9');
    expect(backfillResolveRoom('laser', '2026-07-01T03:01:00Z', logs)).toBe('L2');
  });

  test('AC-3: ±5분 밖 → 귀속불가 NULL (강제귀속 금지)', () => {
    // 01:10:00 전이 → 가장 가까운 상담로그도 gap 6.5분(>5분) → NULL
    expect(backfillResolveRoom('consultation', '2026-07-01T01:10:00Z', logs)).toBeNull();
    // 매칭 room_type 로그 자체 부재
    expect(backfillResolveRoom('examination', '2026-07-01T01:00:00Z', logs)).toBeNull();
    // 미수반 to_status → NULL
    expect(backfillResolveRoom('consult_waiting', '2026-07-01T01:00:00Z', logs)).toBeNull();
  });
});
