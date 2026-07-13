/**
 * E2E — T-20260713-foot-AUTH-ACTOR-AUDIT-APPLEVEL  (B) STRUCTURAL, foot canonical pilot
 *
 * 검증 (티켓 현장 클릭 시나리오 2건):
 *   S1. destructive auth op → actor 기록
 *       admin 세션으로 admin_reset_user_password(대상) 실행 →
 *       staff_auth_action_audit 에 actor=로그인 admin, target=대상, action='password_reset' 행 생성.
 *   S2. append-only + admin-read RLS
 *       - admin 은 감사행 SELECT 가능
 *       - admin(authenticated) 의 감사행 UPDATE/DELETE 는 거부(append-only)
 *       - 비-admin(있을 경우) SELECT 는 거부/0행 (admin-read only)
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
  test('S1: password_reset destructive op → actor 기록 (in-txn 원자적)', async () => {
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
      // ▼ destructive op = admin 세션이 RPC 트리거 (INV-4 posture: 가드 통과 직후 stamp)
      const { error: rpcErr } = await admin.rpc('admin_reset_user_password', {
        target_user_id: targetId, new_password: `New!${rnd}bB`,
      });
      expect(rpcErr).toBeNull();

      // 감사행 확인 (service_role 로 조회 — RLS 무관하게 실재 검증)
      const { data: rows, error: qErr } = await service
        .from('staff_auth_action_audit')
        .select('actor_user_id, target_user_id, target_email, action, occurred_at, request_meta')
        .eq('target_user_id', targetId)
        .eq('action', 'password_reset');
      expect(qErr).toBeNull();
      expect(rows!.length).toBe(1);
      const row = rows![0];
      expect(row.actor_user_id).toBe(actorId);          // "누가" = 로그인 admin
      expect(row.target_user_id).toBe(targetId);
      expect(String(row.target_email).toLowerCase()).toBe(targetEmail.toLowerCase());
      // 비번 평문이 audit 에 적재되지 않았는지 (contract: no plaintext pw)
      expect(JSON.stringify(row.request_meta ?? {})).not.toMatch(/New!|password/i);
      console.log(`[S1] actor=${actorId} → target=${targetId} action=password_reset ✅`);
    } finally {
      // cleanup (service_role 는 append-only REVOKE 대상 아님)
      await service.from('staff_auth_action_audit').delete().eq('target_user_id', targetId);
      await service.auth.admin.deleteUser(targetId);
    }
  });

  test('S2: append-only(no update/delete by authenticated) + admin-read RLS', async () => {
    const admin = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: signErr } = await admin.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
    expect(signErr).toBeNull();

    // seed 1 audit row via service_role
    const service = svc();
    const fakeTarget = crypto.randomUUID();
    const fakeActor = crypto.randomUUID();
    const { data: ins, error: insErr } = await service
      .from('staff_auth_action_audit')
      .insert({ actor_user_id: fakeActor, target_user_id: fakeTarget, target_email: 'zz@medibuilder.test', action: 'deactivate' })
      .select('id').single();
    expect(insErr).toBeNull();
    const auditId = ins!.id;

    try {
      // admin-read: SELECT 가능
      const { data: readRows, error: readErr } = await admin
        .from('staff_auth_action_audit').select('id, action').eq('id', auditId);
      expect(readErr).toBeNull();
      expect(readRows!.length).toBe(1);

      // append-only: admin(authenticated) UPDATE 거부
      const { error: updErr } = await admin
        .from('staff_auth_action_audit').update({ action: 'activate' }).eq('id', auditId);
      expect(updErr).not.toBeNull();
      console.log('[S2] authenticated UPDATE 거부:', updErr?.message);

      // append-only: admin(authenticated) DELETE 거부
      const { error: delErr, count } = await admin
        .from('staff_auth_action_audit').delete({ count: 'exact' }).eq('id', auditId);
      // RLS/권한 거부는 error 또는 0행 삭제로 나타남 — 어느 쪽이든 행은 살아있어야 함
      const { data: still } = await service.from('staff_auth_action_audit').select('id').eq('id', auditId);
      expect(still!.length).toBe(1);
      console.log(`[S2] authenticated DELETE 무효 (err=${delErr?.message ?? 'none'}, count=${count ?? 0}) — 행 보존 ✅`);

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
