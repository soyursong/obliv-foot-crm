/**
 * authAudit — INV-5 (§3-B) app-level 파괴적 auth op 행위주체(actor) 감사.
 * 표준: cross_crm_auth_identity_standard.md v0.3 §3-B + §8-B. foot = canonical pilot.
 *
 * ── foot 변형 (copy-now 팬아웃 시 필독) ──────────────────────────────────
 * 정본 §3-B 는 서버측 service_role 클라이언트가 `admin.from(...).insert()`(직삽입) +
 * `admin.auth.admin.updateUserById()`(GoTrue HTTP) 하는 패턴을 가정한다. foot 은 브라우저에
 * service_role 를 두지 않으므로(키 노출 금지), 감사 write 를 SECURITY DEFINER RPC
 * (record_auth_action / stamp_auth_action_outcome)로 back 한다. 시그니처·호출규약·best-effort
 * 의미(attempted → succeeded/failed)는 §3-B 그대로 보존한다. actor 는 서버(auth.uid())가 확정.
 *
 * 호출 규약 (INV-4 + INV-5):
 *   const auditId = await recordAuthAction(supabase, { actorStaffId, targetUserId, targetEmail, action, requestMeta });
 *   try   { <destructive op RPC/HTTP>; await stampAuthActionOutcome(supabase, auditId, 'succeeded'); }
 *   catch (e) { await stampAuthActionOutcome(supabase, auditId, 'failed'); throw e; }
 *
 * best-effort: 감사 실패가 destructive op(계정복구)를 막지 않는다(감사부재 > 복구차단). warn-log만.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type AuthAuditAction =
  | 'password_reset'
  | 'delete_user'
  | 'ban'
  | 'unban'
  | 'role_change'
  | 'email_change'
  | 'invite_overwrite';

export interface RecordAuthActionArgs {
  /** 로그인 staff canonical id (앱 컨텍스트 known값). null 이면 사람-귀속 공백 → fail-loud warn.
   *  註: DB write 시 actor 는 서버(auth.uid())가 재확정하므로 이 값은 fail-loud 신호용. */
  actorStaffId?: string | null;
  /** INV-4 통과한 대상 auth user id */
  targetUserId: string;
  /** 대상 staff auth email (정규화 전이어도 됨 — 서버에서 lower/trim) */
  targetEmail?: string | null;
  action: AuthAuditAction;
  /** {ip,userAgent,requestId} 등 non-PHI 컨텍스트만. 비번 평문 절대 금지. */
  requestMeta?: Record<string, unknown> | null;
}

/**
 * destructive auth op '직전' 1회 호출. 감사행(outcome='attempted') insert 후 audit id 반환.
 * 실패 시 warn-log 후 null 반환(op 진행을 막지 않음).
 */
export async function recordAuthAction(
  supabase: SupabaseClient,
  { actorStaffId, targetUserId, targetEmail, action, requestMeta }: RecordAuthActionArgs,
): Promise<number | null> {
  if (!actorStaffId) {
    // 사람-귀속 공백 신호 (§3-B fail-loud). op 은 진행하되 관측되게.
    console.warn('[INV-5] actor unresolved — attribution gap', { action, targetUserId });
  }
  try {
    const { data, error } = await supabase.rpc('record_auth_action', {
      p_target_user_id: targetUserId,
      p_target_email: targetEmail ?? null,
      p_action: action,
      p_request_meta: requestMeta ?? null,
    });
    if (error) {
      console.warn('[INV-5] audit insert failed (best-effort)', error);
      return null;
    }
    return typeof data === 'number' ? data : (data ?? null);
  } catch (e) {
    console.warn('[INV-5] audit insert threw (best-effort)', e);
    return null;
  }
}

/**
 * op 성공/실패 후 outcome 확정(narrow update, outcome-only, 1회). auditId 없으면 no-op.
 */
export async function stampAuthActionOutcome(
  supabase: SupabaseClient,
  auditId: number | null,
  outcome: 'succeeded' | 'failed',
): Promise<void> {
  if (!auditId) return; // insert 가 이미 실패한 경우 no-op
  try {
    const { error } = await supabase.rpc('stamp_auth_action_outcome', {
      p_audit_id: auditId,
      p_outcome: outcome,
    });
    if (error) console.warn('[INV-5] outcome stamp failed (best-effort)', error);
  } catch (e) {
    console.warn('[INV-5] outcome stamp threw (best-effort)', e);
  }
}
