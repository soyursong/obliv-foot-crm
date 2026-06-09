// statusFlagTransition — check_ins.status_flag 정본(SSOT) write
// T-20260610-foot-TREATMENT-COMPLETE-BTN
//
// 진료호출(purple)/진료완료(pink) 등 status_flag 전이의 단일 정본 DB write.
//   기존 Dashboard.handleFlagChange(L5022)의 write 코어를 이 함수로 추출해 위임 —
//   진료완료 버튼(DoctorCallDashboard) 등 다른 진입점이 같은 경로를 재사용하기 위함.
//   ⚠️ 병렬 2nd write 신설 금지: status_flag 전이는 반드시 이 함수를 통한다.
//
// 동작(기존 handleFlagChange와 동일):
//   1) check_ins.status_flag 갱신
//   2) status_flag_history JSONB 배열 append (감사 이력 — 실패해도 1)은 유지)
//
// 처리자 기록(의료 추적): history 엔트리에 changed_by(id) + changed_by_name + changed_by_role 적재.
//   → 신규 컬럼 없이 기존 status_flag_history(JSONB) 재사용. 마이그레이션 불필요.
//
// ⚠️ doctor_ack_at(DOCCALL-DOCTOR-ACK, '확인=진료 시작')과 별개 신호 — 이 함수는 ack 컬럼을 만지지 않는다.
import { supabase } from './supabase';
import type { CheckIn, StatusFlag } from './types';

export interface FlagTransitionActor {
  id: string | null;
  name: string | null;
  role: string | null;
}

/**
 * status_flag 전이 정본 write.
 * @throws status_flag 갱신 실패 시 (감사 이력 append 실패는 흡수 — 플래그 변경 유지)
 */
export async function applyStatusFlagTransition(
  checkIn: Pick<CheckIn, 'id' | 'status_flag_history'>,
  flag: StatusFlag | null,
  actor: FlagTransitionActor,
): Promise<void> {
  const now = new Date().toISOString();
  const historyEntry = {
    flag,
    changed_at: now,
    changed_by: actor.id ?? null,
    changed_by_name: actor.name ?? null,
    changed_by_role: actor.role ?? null,
  };

  // 1) status_flag 갱신 (정본)
  const { error } = await supabase
    .from('check_ins')
    .update({ status_flag: flag })
    .eq('id', checkIn.id);
  if (error) throw error;

  // 2) 감사 이력 append (실패해도 플래그 변경은 유지)
  await supabase
    .from('check_ins')
    .update({
      status_flag_history: (checkIn.status_flag_history ?? []).concat([historyEntry]),
    })
    .eq('id', checkIn.id)
    .then(() => {
      /* 이력 저장 실패해도 플래그 변경은 유지 */
    });
}
