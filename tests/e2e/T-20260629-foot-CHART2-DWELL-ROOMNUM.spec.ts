/**
 * T-20260629-foot-CHART2-DWELL-ROOMNUM — 2번차트 체류시간: 머문 방 번호(코드) 표기
 *
 * Phase1 결정(dev-foot):
 *   - status_transitions.room_id 는 FE 가 미기록(항상 NULL) → 사용 불가.
 *   - 실제 방 데이터 = check_in_room_logs.assigned_room (= rooms.name, 현장 코드 C{N}/L{N}/상담실{N} 그대로).
 *   - 옵션 B(FE-only): 방배정 로그를 체류 세그먼트와 시간창(±90초) 매칭해 방 코드를 부여.
 *     신규 테이블/컬럼/RPC 변경 없음(AC-4 1순위).
 *
 * 본 spec 은 CustomerChartPage.tsx 의 resolveDwellRoom 매칭 + (status, 방) 집계 로직을
 * 코드와 동일하게 재현해 회귀 가드한다 (DB/브라우저 불필요 순수 로직 — 기존 SLOT-DWELL-TIME spec 동형).
 *
 * AC-1(방 번호 표시): 각 항목에 머문 방 코드(상담실N / C{N} / L{N})가 타입과 함께 표시.
 * AC-2(회귀 가드): 방 미상이면 기존 status 단독 집계와 동일(값·행 수 회귀 0). 총 체류 불변.
 * AC-3(방 미상 처리): room_id/배정 로그 없으면 타입만(에러·깨짐 없음, room=null).
 */
import { test, expect } from '@playwright/test';

// ──────────────────────────────────────────────────────────────────────
// CustomerChartPage.tsx 재현 — 세그먼트별 방 해석 + (status, 방) 집계
// ──────────────────────────────────────────────────────────────────────
interface SlotDwellSeg {
  status: string;
  entered_at: string;
  exited_at: string;
  duration_seconds: number;
}
interface DwellRoomLog {
  assigned_room: string;
  room_type: string;
  logged_at: string;
}

const DWELL_STATUS_TO_ROOM_TYPE: Record<string, string> = {
  consultation: 'consultation',
  examination: 'examination',
  preconditioning: 'treatment',
  laser: 'laser',
};
const DWELL_ROOM_MATCH_TOL_MS = 90 * 1000;

function resolveDwellRoom(seg: SlotDwellSeg, logs: DwellRoomLog[]): string | null {
  const rt = DWELL_STATUS_TO_ROOM_TYPE[seg.status];
  if (!rt) return null;
  const cand = logs.filter((l) => l.room_type === rt);
  if (cand.length === 0) return null;
  const entered = new Date(seg.entered_at).getTime();
  const exited = new Date(seg.exited_at).getTime();
  const within = cand.filter((l) => {
    const t = new Date(l.logged_at).getTime();
    return t >= entered - DWELL_ROOM_MATCH_TOL_MS && t <= exited + DWELL_ROOM_MATCH_TOL_MS;
  });
  const pool = within.length > 0
    ? within
    : cand.filter((l) => new Date(l.logged_at).getTime() <= exited + DWELL_ROOM_MATCH_TOL_MS);
  if (pool.length === 0) return null;
  return pool.reduce((a, b) =>
    (new Date(a.logged_at).getTime() >= new Date(b.logged_at).getTime() ? a : b),
  ).assigned_room || null;
}

// (status, 방코드) 단위 집계 — 같은 타입 다른 방은 별 행
function aggregate(segs: SlotDwellSeg[], logs: DwellRoomLog[]) {
  const agg = new Map<string, { status: string; room: string | null; sec: number }>();
  for (const s of segs) {
    const room = resolveDwellRoom(s, logs);
    const key = `${s.status} ${room ?? ''}`;
    const cur = agg.get(key);
    if (cur) cur.sec += s.duration_seconds;
    else agg.set(key, { status: s.status, room, sec: s.duration_seconds });
  }
  return agg;
}

test.describe('T-20260629-foot-CHART2-DWELL-ROOMNUM (pure-logic)', () => {
  // ── 시나리오 1: 방 번호 표시 정상 동선 ──────────────────────────────
  test('AC-1: 각 항목에 머문 방 코드(상담실N / C{N} / L{N})가 타입과 함께 부여된다', () => {
    // 상담실2(10:05) → C2(10:20) → L1(11:00) 배정 로그
    const segs: SlotDwellSeg[] = [
      { status: 'consultation',   entered_at: '2026-06-29T10:05:00+09:00', exited_at: '2026-06-29T10:15:00+09:00', duration_seconds: 600 },
      { status: 'preconditioning', entered_at: '2026-06-29T10:20:00+09:00', exited_at: '2026-06-29T11:05:00+09:00', duration_seconds: 2700 },
      { status: 'laser',          entered_at: '2026-06-29T11:00:00+09:00', exited_at: '2026-06-29T11:18:00+09:00', duration_seconds: 1080 },
    ];
    const logs: DwellRoomLog[] = [
      { assigned_room: '상담실2', room_type: 'consultation', logged_at: '2026-06-29T10:05:10+09:00' },
      { assigned_room: 'C2',      room_type: 'treatment',    logged_at: '2026-06-29T10:20:05+09:00' },
      { assigned_room: 'L1',      room_type: 'laser',        logged_at: '2026-06-29T11:00:08+09:00' },
    ];
    expect(resolveDwellRoom(segs[0], logs)).toBe('상담실2'); // 상담실 → 한글명+숫자
    expect(resolveDwellRoom(segs[1], logs)).toBe('C2');      // 치료실 → C 접두
    expect(resolveDwellRoom(segs[2], logs)).toBe('L1');      // 레이저실 → L 접두
  });

  // 시나리오 1-4: 같은 타입의 다른 번호 방(L1, L2)을 거치면 각각 별 항목/번호로 구분
  test('AC-1: 같은 타입 다른 방(L1, L2)은 각각 별 행으로 집계된다', () => {
    const segs: SlotDwellSeg[] = [
      { status: 'laser', entered_at: '2026-06-29T11:00:00+09:00', exited_at: '2026-06-29T11:15:00+09:00', duration_seconds: 900 },
      { status: 'laser', entered_at: '2026-06-29T11:20:00+09:00', exited_at: '2026-06-29T11:32:00+09:00', duration_seconds: 720 },
    ];
    const logs: DwellRoomLog[] = [
      { assigned_room: 'L1', room_type: 'laser', logged_at: '2026-06-29T11:00:05+09:00' },
      { assigned_room: 'L2', room_type: 'laser', logged_at: '2026-06-29T11:20:03+09:00' },
    ];
    const agg = aggregate(segs, logs);
    expect(agg.size).toBe(2); // L1, L2 별도 행
    expect(agg.get('laser L1')?.sec).toBe(900);
    expect(agg.get('laser L2')?.sec).toBe(720);
  });

  // ── 시나리오 2: 회귀 가드 ──────────────────────────────────────────
  test('AC-2: 방 배정 로그가 없으면 기존 status 단독 집계와 동일(값·행 수 회귀 0)', () => {
    const segs: SlotDwellSeg[] = [
      { status: 'registered',     entered_at: '2026-06-29T10:00:00+09:00', exited_at: '2026-06-29T10:05:00+09:00', duration_seconds: 300 },
      { status: 'consultation',   entered_at: '2026-06-29T10:05:00+09:00', exited_at: '2026-06-29T10:35:00+09:00', duration_seconds: 1800 },
      { status: 'preconditioning', entered_at: '2026-06-29T10:35:00+09:00', exited_at: '2026-06-29T11:05:00+09:00', duration_seconds: 1800 },
    ];
    const agg = aggregate(segs, []); // 방 로그 없음(과거 데이터)
    // 기존 status-단독 집계와 동일: 3개 행, room=null, 값 보존
    expect(agg.size).toBe(3);
    expect(agg.get('registered ')?.room).toBeNull();
    expect(agg.get('consultation ')?.sec).toBe(1800);
    expect(agg.get('preconditioning ')?.sec).toBe(1800);
    // 총 체류 불변
    const total = Array.from(agg.values()).reduce((s, r) => s + r.sec, 0);
    expect(total).toBe(300 + 1800 + 1800);
  });

  test('AC-2: 방 코드가 붙어도 같은 방 단일이면 타입별 값·총합 보존', () => {
    const segs: SlotDwellSeg[] = [
      { status: 'consultation',   entered_at: '2026-06-29T10:05:00+09:00', exited_at: '2026-06-29T10:35:00+09:00', duration_seconds: 1800 },
      { status: 'preconditioning', entered_at: '2026-06-29T10:35:00+09:00', exited_at: '2026-06-29T11:05:00+09:00', duration_seconds: 1800 },
    ];
    const logs: DwellRoomLog[] = [
      { assigned_room: '상담실1', room_type: 'consultation', logged_at: '2026-06-29T10:05:05+09:00' },
      { assigned_room: 'C3',      room_type: 'treatment',    logged_at: '2026-06-29T10:35:05+09:00' },
    ];
    const agg = aggregate(segs, logs);
    expect(agg.size).toBe(2); // 타입별 1행 유지(단일 방)
    expect(agg.get('consultation 상담실1')?.sec).toBe(1800);
    expect(agg.get('preconditioning C3')?.sec).toBe(1800);
    const total = Array.from(agg.values()).reduce((s, r) => s + r.sec, 0);
    expect(total).toBe(3600);
  });

  // ── 시나리오 3: 방 번호 미상 엣지 ──────────────────────────────────
  test('AC-3: 매핑 불가/방 없는 상태(대기 등)는 room=null → 타입만, 에러 없음', () => {
    const segs: SlotDwellSeg[] = [
      { status: 'treatment_waiting', entered_at: '2026-06-29T10:00:00+09:00', exited_at: '2026-06-29T10:10:00+09:00', duration_seconds: 600 },
      { status: 'preconditioning',   entered_at: '2026-06-29T10:10:00+09:00', exited_at: '2026-06-29T10:40:00+09:00', duration_seconds: 1800 },
    ];
    // 치료실 배정 로그는 있지만 대기 상태는 room_type 매핑 자체가 없음
    const logs: DwellRoomLog[] = [
      { assigned_room: 'C1', room_type: 'treatment', logged_at: '2026-06-29T10:10:05+09:00' },
    ];
    expect(resolveDwellRoom(segs[0], logs)).toBeNull();    // 대기 → 방 없음
    expect(resolveDwellRoom(segs[1], logs)).toBe('C1');     // 치료실 → C1
  });

  test('AC-3: 타입은 매핑되나 배정 로그가 비면 null(graceful, 크래시 없음)', () => {
    const seg: SlotDwellSeg = { status: 'laser', entered_at: '2026-06-29T11:00:00+09:00', exited_at: '2026-06-29T11:18:00+09:00', duration_seconds: 1080 };
    expect(resolveDwellRoom(seg, [])).toBeNull();
    // 타입은 있으나 다른 타입 로그만 존재 → null
    expect(resolveDwellRoom(seg, [{ assigned_room: 'C2', room_type: 'treatment', logged_at: '2026-06-29T11:00:00+09:00' }])).toBeNull();
  });

  // 시간창 폴백: 이전 상태에서 이미 배정돼 그대로 점유 중인 방(구간 시작 전 마지막 배정)
  test('매칭: 구간 내 로그 없으면 구간 종료 이전 마지막 배정으로 폴백', () => {
    const seg: SlotDwellSeg = { status: 'preconditioning', entered_at: '2026-06-29T10:30:00+09:00', exited_at: '2026-06-29T11:00:00+09:00', duration_seconds: 1800 };
    const logs: DwellRoomLog[] = [
      // 배정은 10:10(이전 상태 시점), 이후 같은 방 점유 유지 → C2 폴백
      { assigned_room: 'C2', room_type: 'treatment', logged_at: '2026-06-29T10:10:00+09:00' },
    ];
    expect(resolveDwellRoom(seg, logs)).toBe('C2');
  });
});
