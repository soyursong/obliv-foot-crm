import { supabase } from '@/lib/supabase';

// T-20260611-foot-SPACE-RESET-RECUR5 (Phase B, 5차 재발 근본 수정):
//   확정 근본원인(diagnose-first, 3df8d05): read-path carry-over 의 baseline 이
//   "today 이전 가장 최근 '날짜' 한 개의 풀 스냅샷"(priorMax 단일날짜)이었다.
//   06-10 에 단 2개 방만 부분저장되면 priorMax=06-10 이라 baseline 이 그 2방뿐 →
//   06-09 풀 로스터(20/28)가 통째로 사라져 06-11 보드가 빈칸 = "또 리셋".
//
//   수정: baseline 을 단일날짜가 아니라 **room_name 별 prior-latest** 로 carry-over.
//     prior(date<today) 전부를 날짜 오름차순으로 가져와 방별로 fold → 각 방은
//     "그 방이 마지막으로 저장된 날의 값"을 갖는다. 부분저장이 다른 방의 carry-over 를
//     더 이상 가리지 못한다.
//
//   ⚠ 부분저장 today + 미터치 방 (planner B-GO 조건2, RECUR6 차단):
//     today 행이 '부분'으로 존재해도(예: 06-11 현재 3/28) today overlay 는 today 행이
//     있는 방만 덮어쓴다. today 행이 없는 방은 그대로 room별 prior-latest 가 노출된다.
//     → 06-09 풀 로스터가 부분저장 뒤에도 영구 그림자가 되지 않는다.
//
//   B1 불변 보존:
//     B1-a 미터치 방 보존 — today 행 없는 방은 prior-latest carry-over (blind-wipe 없음).
//     B1-b 의도 unassign 반영 — 방의 prior-latest 가 staff_id=null 이면 미배정으로 노출
//          (마지막 의도가 "미배정"이면 그대로 carry-over).
//   DB 스키마 무변경 · 행 DELETE/변경 없음(읽기 머지 전용).

/** Staff(RoomAssignmentRow) / Dashboard(RoomAssignment) 양쪽이 공유하는 최소 형상. */
export interface RoomAssignmentLike {
  date: string;
  room_name: string;
  staff_id: string | null;
}

export interface EffectiveRoomAssignments<T extends RoomAssignmentLike> {
  /** room_name → effective row (prior-latest baseline 위에 today overlay) */
  byRoom: Map<string, T>;
  /** byRoom 의 값 배열 */
  rows: T[];
  /** today 행이 1건이라도 존재하는지 (라벨/인디케이터용) */
  hasToday: boolean;
  /** carry-over 기준이 되는 가장 최근 prior 날짜 (라벨용, null=prior 없음). */
  lastPriorDate: string | null;
}

/**
 * 특정 clinic·date 의 "effective" 공간배정을 계산한다.
 * room_name 별 prior-latest baseline + today overlay (today 우선).
 *
 * @param selectCols supabase select 컬럼 목록. Dashboard 는 페이로드 축소를 위해
 *   필요 컬럼만, Staff 는 '*' 사용. 머지 키(date/room_name/staff_id)는 반드시 포함할 것.
 */
export async function fetchEffectiveRoomAssignments<T extends RoomAssignmentLike>(
  clinicId: string,
  dateStr: string,
  selectCols = '*',
): Promise<EffectiveRoomAssignments<T>> {
  // 1) today 행
  const { data: todayRows, error: todayErr } = await supabase
    .from('room_assignments')
    .select(selectCols)
    .eq('clinic_id', clinicId)
    .eq('date', dateStr);
  if (todayErr) throw todayErr;

  // 2) prior(date < today) 전부 — 날짜 오름차순.
  //    room_assignments 는 (clinic,date,room) 당 1행이라 운영상 행수가 작다(일 수십 행).
  //    단일 priorMax 날짜만 보던 기존 결함을 없애기 위해 prior 전체를 fold 한다.
  const { data: priorRows, error: priorErr } = await supabase
    .from('room_assignments')
    .select(selectCols)
    .eq('clinic_id', clinicId)
    .lt('date', dateStr)
    .order('date', { ascending: true });
  if (priorErr) throw priorErr;

  // 3) room_name 별 prior-latest: 오름차순 fold → 같은 방의 더 늦은 날짜가 이전 날짜를 덮어씀.
  const byRoom = new Map<string, T>();
  let lastPriorDate: string | null = null;
  for (const r of (priorRows ?? []) as unknown as T[]) {
    byRoom.set(r.room_name, r);
    if (!lastPriorDate || r.date > lastPriorDate) lastPriorDate = r.date;
  }

  // 4) today overlay — today 행이 있는 방만 덮어쓴다(부분저장이어도 미터치 방은 prior-latest 유지).
  const today = (todayRows ?? []) as unknown as T[];
  for (const r of today) byRoom.set(r.room_name, r);

  return {
    byRoom,
    rows: Array.from(byRoom.values()),
    hasToday: today.length > 0,
    lastPriorDate,
  };
}
