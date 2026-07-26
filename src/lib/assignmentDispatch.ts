/**
 * assignmentDispatch — 금일 배분 이력 '확정' 발송 게이트 seam
 * (T-20260726-foot-ASSIGN-SENDCONFIRM-WEEKLYTARGET 변경2)
 *
 * 정책
 *  · 배정 즉시 자동발송(구 실행5) 없음. 발송은 오직 '금일 배분 이력'의 [확정] 클릭 시에만 발화한다.
 *  · dependency(V1 dependency_2 상속): 실제 Slack 발송 배선은 장쳰봇(C0B4HEC9SHH) 미초대로 블록.
 *    → 봇 초대 전까지 sendAssignmentSlack 은 no-op(발송대기)로 성공 반환한다. 게이트 골격만 선구현.
 *    → 봇 초대 후 후속 티켓에서 이 함수 본문만 실제 발송(EF/RPC)로 교체하면 UI/게이트 무변경으로 언블록.
 *
 * 멱등: 발송 여부(dispatched)는 호출측이 확정 건 id(check_in_id:role) 집합으로 가드한다.
 *       이 함수는 순수 발송 경계이며 상태를 저장하지 않는다(no-op 단계에서 DB 무접촉, no-DDL).
 */

/** 봇 초대 여부 플래그 — 초대 완료 시 true 로 전환(후속 티켓). 현재 미초대 → no-op. */
export const ASSIGNMENT_SLACK_BOT_JOINED = false;

export interface AssignmentSlackPayload {
  /** 멱등 키 = `${check_in_id}:${role}` (금일 배분 이력 행 id). */
  rowId: string;
  role: 'consult' | 'therapy';
  staffId: string | null;
  customerName: string;
}

export interface AssignmentSlackResult {
  ok: boolean;
  /** true = 봇 미초대로 실제 발송 없이 '발송대기'만 확정(게이트 통과, no-op). */
  noop: boolean;
  reason?: string;
}

/**
 * 배정 1건 Slack 발송(게이트 통과 후 호출). 봇 미초대(ASSIGNMENT_SLACK_BOT_JOINED=false) 동안은
 * 실제 발송 없이 성공 반환(no-op) → 클릭=상태만 '발송대기' 확정. best-effort: throw 하지 않음.
 */
export async function sendAssignmentSlack(
  _payload: AssignmentSlackPayload,
): Promise<AssignmentSlackResult> {
  if (!ASSIGNMENT_SLACK_BOT_JOINED) {
    // 봇 미초대 — 발송대기(no-op). 후속 티켓에서 여기에 실제 발송 배선.
    return { ok: true, noop: true, reason: 'bot_not_joined' };
  }
  // TODO(bot-join): 실제 Slack 발송(EF/RPC) 배선. 실패 시 { ok:false } 반환(호출측 미확정 유지).
  return { ok: true, noop: false };
}
