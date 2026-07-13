/**
 * E2E — T-20260713-foot-AUTH-ACTOR-AUDIT-APPLEVEL  (B) STRUCTURAL, foot canonical pilot
 * 정본: cross_crm_auth_identity_standard.md v0.3 §3-B(client-orchestrated call convention) + §8-B(DDL).
 *
 * ── 설계 (Design B, §3-B client-orchestrated) ─────────────────────────────
 *   foot 의 destructive auth op(admin_reset_user_password / admin_toggle_user_active /
 *   admin_register_user)은 기존 RPC 그대로(무변경)이고, 감사는 FE 가 그 op 를 **감싸서**
 *   record_auth_action(op 직전 insert) → op → stamp_auth_action_outcome(성공/실패 outcome 1회 UPDATE)
 *   로 남긴다. 그러므로 이 spec 도 FE 호출규약을 그대로 재현한다(=RPC 를 직접 호출하지 않고 record/op/stamp 시퀀스).
 *
 * 검증 (티켓 현장 클릭 시나리오 2건):
 *   S1. destructive auth op → actor 기록 (§3-B 시퀀스)
 *       admin 세션으로 record_auth_action → admin_reset_user_password → stamp_auth_action_outcome('succeeded').
 *       staff_auth_action_audit 에 action='password_reset', target=대상, outcome='succeeded' 행 1건.
 *       actor 귀속 = record_auth_action 이 auth.uid() 서버확정으로 staff 매핑(actor_staff_id).
 *       ★ foot 관측: admin 이 staff row 미보유 시 actor_staff_id=NULL(§8-B 설계상 nullable=fail-loud gap).
 *   S2. append-only + admin-read RLS + outcome-stamp 허용경로(1회 UPDATE)
 *       - admin 은 감사행 SELECT 가능 / admin(authenticated) 의 직접 UPDATE·DELETE 거부(append-only)
 *       - 유일 UPDATE 경로 = stamp_auth_action_outcome(attempted→succeeded 1회), 재호출 no-op(불변)
 *       - 비-admin(있을 경우) SELECT 거부/0행 (admin-read only)
 *
 * 비파괴: throwaway 대상 유저 + 감사행을 service_role 로 생성·정리(cleanup). 기존 계정/데이터 무변경.
 * 선행: 20260713170000 마이그 prod 적용 필요. 미적용 시 이 spec 은 실패(=게이트 신호).
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TEST_EMAIL = process.env.TEST_EMAIL ?? 'test@medibuilder.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })();
// 선택: 비-admin 계정(있으면 admin-read only 음성검증 강화). 없으면 해당 assert skip.
const NONADMIN_EMAIL = process.env.TEST_NONADMIN_EMAIL;
const NONADMIN_PASSWORD = process.env.TEST_NONADMIN_PASSWORD;

const svc = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

test.describe('T-20260713 actor audit (foot canonical pilot)', () => {
  test('S1: password_reset destructive op → actor 기록 (§3-B record→op→stamp)', async () => {
    const admin = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: sess, error: signErr } = await admin.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
    expect(signErr).toBeNull();
    const actorId = sess.user!.id;

    // throwaway 대상 유저 생성 (service_role) — 실제 직원 계정 건드리지 않음
    const service = svc();
    const rnd = String(Math.floor(Math.random() * 1_0000_0000)).padStart(8, '0');
    const targetEmail = `zz-audit-target-${rnd}@medibuilder.test`;
    const { data: created, error: cErr } = await service.auth.admin.createUser({
      email: targetEmail, password: `Tmp!${rnd}aA`, email_confirm: true,
    });
    expect(cErr).toBeNull();
    const targetId = created.user!.id;

    try {
      // ▼ §3-B 호출규약 재현: record_auth_action(op 직전) → destructive op → stamp_auth_action_outcome
      const { data: auditId, error: recErr } = await admin.rpc('record_auth_action', {
        p_target_user_id: targetId,
        p_target_email: targetEmail,
        p_action: 'password_reset',
        p_request_meta: { requestId: `e2e-${rnd}` },
      });
      expect(recErr).toBeNull();
      expect(typeof auditId).toBe('number');

      const { error: rpcErr } = await admin.rpc('admin_reset_user_password', {
        target_user_id: targetId, new_password: `New!${rnd}bB`,
      });
      expect(rpcErr).toBeNull();

      const { error: stampErr } = await admin.rpc('stamp_auth_action_outcome', {
        p_audit_id: auditId, p_outcome: 'succeeded',
      });
      expect(stampErr).toBeNull();

      // 감사행 확인 (service_role 로 조회 — RLS 무관하게 실재 검증)
      const { data: rows, error: qErr } = await service
        .from('staff_auth_action_audit')
        .select('actor_staff_id, target_user_id, target_email, action, outcome, occurred_at, request_meta')
        .eq('id', auditId);
      expect(qErr).toBeNull();
      expect(rows!.length).toBe(1);
      const row = rows![0];
      expect(row.target_user_id).toBe(targetId);
      expect(String(row.target_email).toLowerCase()).toBe(targetEmail.toLowerCase());
      expect(row.action).toBe('password_reset');
      expect(row.outcome).toBe('succeeded');                        // stamp 반영
      // 비번 평문이 audit 에 적재되지 않았는지 (contract: no plaintext pw)
      expect(JSON.stringify(row.request_meta ?? {})).not.toMatch(/New!|password/i);

      // actor 귀속 검증: record_auth_action 이 auth.uid()→staff 로 서버확정.
      //   admin 이 staff row 보유 시 actor_staff_id=해당 staff.id / 미보유 시 NULL(§8-B 설계상 gap, fail-loud).
      const { data: staffRow } = await service.from('staff').select('id').eq('user_id', actorId).maybeSingle();
      if (staffRow?.id) {
        expect(row.actor_staff_id).toBe(staffRow.id);               // "누가" = 로그인 admin 의 staff id
        console.log(`[S1] actor_staff_id=${row.actor_staff_id} (staff mapped) → target=${targetId} ✅`);
      } else {
        // ★ foot canonical pilot 관측: admin 이 staff 미보유 → actor_staff_id NULL(사람-귀속 공백).
        //   §8-B 는 nullable+fail-loud 설계. 이 gap 은 planner→DA FOLLOWUP(actor_user_id 승격 제안)의 근거.
        expect(row.actor_staff_id).toBeNull();
        console.warn(`[S1][INV-5 gap] actor(auth.uid=${actorId}) has no staff row → actor_staff_id=NULL. `
          + `op/target/action/outcome 은 기록되나 "누가"는 staff 미매핑. → DA §8-B actor_user_id 승격 검토 근거.`);
      }
    } finally {
      // cleanup (service_role 는 append-only REVOKE 대상 아님)
      await service.from('staff_auth_action_audit').delete().eq('target_user_id', targetId);
      await service.auth.admin.deleteUser(targetId);
    }
  });

  test('S2: append-only(no direct update/delete) + admin-read RLS + outcome-stamp 허용경로', async () => {
    const admin = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: signErr } = await admin.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
    expect(signErr).toBeNull();

    // seed 1 audit row via service_role (outcome=attempted 로 시작 — stamp 허용경로 검증용)
    const service = svc();
    const fakeTarget = crypto.randomUUID();
    const fakeStaff = crypto.randomUUID();
    const { data: ins, error: insErr } = await service
      .from('staff_auth_action_audit')
      .insert({ actor_staff_id: fakeStaff, target_user_id: fakeTarget, target_email: 'zz@medibuilder.test', action: 'ban', outcome: 'attempted' })
      .select('id').single();
    expect(insErr).toBeNull();
    const auditId = ins!.id;

    try {
      // admin-read: SELECT 가능
      const { data: readRows, error: readErr } = await admin
        .from('staff_auth_action_audit').select('id, action, outcome').eq('id', auditId);
      expect(readErr).toBeNull();
      expect(readRows!.length).toBe(1);

      // append-only: admin(authenticated) 직접 UPDATE 거부 (immutable — actor/target/action)
      const { error: updErr } = await admin
        .from('staff_auth_action_audit').update({ action: 'unban' }).eq('id', auditId);
      expect(updErr).not.toBeNull();
      console.log('[S2] authenticated 직접 UPDATE 거부:', updErr?.message);

      // append-only: admin(authenticated) 직접 DELETE 거부 → 행 보존
      const { error: delErr, count } = await admin
        .from('staff_auth_action_audit').delete({ count: 'exact' }).eq('id', auditId);
      const { data: still } = await service.from('staff_auth_action_audit').select('id, action').eq('id', auditId);
      expect(still!.length).toBe(1);
      expect(still![0].action).toBe('ban');                         // action immutable — 그대로
      console.log(`[S2] authenticated DELETE 무효 (err=${delErr?.message ?? 'none'}, count=${count ?? 0}) — 행 보존 ✅`);

      // 허용경로: stamp_auth_action_outcome 로 outcome 만 1회 UPDATE (attempted→succeeded)
      const { error: stampErr } = await admin.rpc('stamp_auth_action_outcome', { p_audit_id: auditId, p_outcome: 'succeeded' });
      expect(stampErr).toBeNull();
      const { data: afterStamp } = await service.from('staff_auth_action_audit').select('outcome').eq('id', auditId).single();
      expect(afterStamp!.outcome).toBe('succeeded');                // outcome 만 전이됨
      // 1회 전이만: 재호출은 no-op (이미 succeeded → attempted 아님)
      await admin.rpc('stamp_auth_action_outcome', { p_audit_id: auditId, p_outcome: 'failed' });
      const { data: afterRe } = await service.from('staff_auth_action_audit').select('outcome').eq('id', auditId).single();
      expect(afterRe!.outcome).toBe('succeeded');                   // 불변 — 재전이 안 됨
      console.log('[S2] outcome stamp 1회 UPDATE 허용 + 재호출 no-op ✅');

      // admin-read only: 비-admin SELECT 거부/0행 (creds 있을 때만)
      if (NONADMIN_EMAIL && NONADMIN_PASSWORD) {
        const nonAdmin = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
        const { error: naSign } = await nonAdmin.auth.signInWithPassword({ email: NONADMIN_EMAIL, password: NONADMIN_PASSWORD });
        expect(naSign).toBeNull();
        const { data: naRows, error: naErr } = await nonAdmin.from('staff_auth_action_audit').select('id').eq('id', auditId);
        if (naErr) {
          expect(naErr.message).toMatch(/permission|policy|rls/i);
        } else {
          expect(naRows!.length).toBe(0);  // RLS admin-only → 비admin 0행
        }
        console.log('[S2] non-admin SELECT 차단 확인 ✅');
      } else {
        console.log('[S2] non-admin creds 미제공 → admin-read only 음성검증 skip');
      }
    } finally {
      await service.from('staff_auth_action_audit').delete().eq('id', auditId);
    }
  });
});
