/**
 * apply_20260810190000_foot_rls_anon_checklists_seal.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * 티켓: T-20260810-foot-RLS-ANON-LEGITPATH-DACONSULT
 * 게이트: supervisor DB-GATE GO-token (ed25519). ⚠ GO-token 前 prod DDL 선집행 금지(C20/C24).
 *   apply = supervisor DB-GATE lane. GO-token(.json+.sig) 검증 후에만 prod COMMIT.
 * 대상 마이그: supabase/migrations/20260810190000_foot_rls_anon_checklists_seal.sql
 *   ADDITIVE RESTRICTIVE anon-deny x2 (checklists read + write) — permissive 존치.
 *
 * 실행:
 *   node scripts/apply_20260810190000_foot_rls_anon_checklists_seal.mjs          # PRE-PROBE only(비 apply)
 *   node scripts/apply_20260810190000_foot_rls_anon_checklists_seal.mjs --apply  # gate → apply → POST-PROBE(structural+behavioral)
 */
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { query, applyMigration, MIG_DIR } from './lib/foot_migration_ledger.mjs';
import { assertApplyGateForRunner, FOOT_PROD_REF } from './apply_gate_lib.mjs';

const APPLY = process.argv.includes('--apply');
const VERSION = '20260810190000';
const FILE = '20260810190000_foot_rls_anon_checklists_seal.sql';
const TICKET_ID = 'T-20260810-foot-RLS-ANON-LEGITPATH-DACONSULT';
const REF = FOOT_PROD_REF;
const __dir = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_LOG = join(__dir, '../db-gate/_apply_evidence/runner_apply.log.jsonl');
const SQL_FILE = join(MIG_DIR, FILE);

async function qsafe(name, sql) {
  try { const r = await query(sql); console.log(`  [${name}]`, JSON.stringify(r)); return r; }
  catch (e) { console.log(`  [${name}] (query error)`, e.message); return null; }
}

async function structuralProbe(label) {
  console.log(`\n══════════ ${label} ══════════`);
  await qsafe('policies (checklists)', `SELECT tablename, policyname, cmd, permissive, roles::text roles,
      left(qual,30) qual, left(with_check,30) with_check
    FROM pg_policies WHERE schemaname='public' AND tablename='checklists'
    ORDER BY permissive DESC, policyname`);
  await qsafe('restrictive anon-deny count (expect 2 post-apply · roles={anon})', `SELECT count(*) n FROM pg_policies
    WHERE schemaname='public' AND tablename='checklists' AND permissive='RESTRICTIVE' AND roles::text='{anon}'
      AND policyname IN ('checklists_anon_read_deny','checklists_anon_write_deny')`);
  await qsafe('permissive anon direct residual (ADDITIVE: expect 2, untouched)', `SELECT count(*) n FROM pg_policies
    WHERE schemaname='public' AND tablename='checklists'
      AND policyname IN ('anon_checklist_read','anon_checklist_write')`);
  await qsafe('C2 authenticated 정책 6종 (expect 6, untouched)', `SELECT count(*) n FROM pg_policies
    WHERE schemaname='public' AND tablename='checklists'
      AND policyname IN ('auth_users_all','checklists_admin_all','checklists_approved_read',
                         'checklists_consult_update','checklists_coord_insert','checklists_coord_update')`);
  await qsafe('C1 SECDEF 독립 (fn_complete_prescreen_checklist prosecdef=true·owner·EXECUTE anon 무접촉)', `SELECT p.proname, p.prosecdef,
      pg_get_userbyid(p.proowner) owner,
      has_function_privilege('anon', p.oid, 'EXECUTE') anon_exec
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='fn_complete_prescreen_checklist'`);
}

// behavioral anon-role RLS probe (guaranteed rollback — final RAISE aborts txn → no persistence).
async function behavioralProbe() {
  console.log(`\n══════════ POST-PROBE (behavioral anon-role RLS · guaranteed rollback) ══════════`);
  const probe = `
DO $probe$
DECLARE res text := ''; c_chk int;
BEGIN
  -- service_role(BYPASSRLS) 실 row 수 대조
  SELECT count(*) INTO c_chk FROM public.checklists;
  res := res||'chk_total='||c_chk||';';

  -- anon 롤 컨텍스트 SELECT → RESTRICTIVE anon read-deny 로 0 기대
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  BEGIN SELECT count(*) INTO c_chk FROM public.checklists;  res:=res||'anon_read='||c_chk||';';
  EXCEPTION WHEN insufficient_privilege THEN res:=res||'anon_read=BLOCKED;'; WHEN others THEN res:=res||'anon_read=ERR'||SQLSTATE||';'; END;

  -- anon 롤 컨텍스트 INSERT → RESTRICTIVE anon write-deny 로 실패 기대(RLS violation)
  BEGIN
    INSERT INTO public.checklists (clinic_id, check_in_id, checklist_data)
      VALUES ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
    res:=res||'anon_write=ALLOWED(!!);';
  EXCEPTION
    WHEN insufficient_privilege THEN res:=res||'anon_write=BLOCKED_RLS;';
    WHEN others THEN res:=res||'anon_write=BLOCKED('||SQLSTATE||');';
  END;

  RESET ROLE;
  RAISE EXCEPTION 'PROBE_ROLLBACK_OK :: %', res;  -- 무영속 rollback
END $probe$;`;
  await qsafe('anon-role probe (expect chk_total 실측 & anon_read=0 & anon_write=BLOCKED*)', probe);
  console.log('  ※ REST 계층 anon-key 실효 + SECDEF RPC 회귀0 은 scripts/T-20260810-foot-RLS-ANON-LEGITPATH-DACONSULT_postcheck.mjs 로 별도 실측');
}

(async () => {
  await structuralProbe('PRE-PROBE (apply 전 현재 상태)');
  if (!APPLY) {
    console.log('\n(PRE-PROBE only) --apply 미지정 → prod 무변경. GO-token 발행 후 --apply 재실행.');
    return;
  }
  // ── DB-GATE: GO-token 검증(prod lane 필수). 부재/불일치/만료 → abort ──
  const gate = assertApplyGateForRunner({
    ticketId: TICKET_ID, targetRef: REF, applyRequested: true,
    migrationSqlFile: SQL_FILE, evidenceLog: EVIDENCE_LOG,
  });
  console.log('\n[DB-GATE] GO-token 검증 통과:', JSON.stringify(gate));

  // ── prod COMMIT (ledger 경유 apply) ──
  console.log('\n[APPLY] prod COMMIT 시작…');
  const r = await applyMigration({ version: VERSION, file: FILE, dryRun: false, createdBy: 'dev-foot:'+TICKET_ID });
  console.log('[APPLY] 완료:', JSON.stringify(r));

  await structuralProbe('POST-PROBE (structural)');
  await behavioralProbe();
  console.log('\n※ 이후 scripts/..._postcheck.mjs (anon-key REST 실효 + SECDEF RPC write 회귀0) 실행할 것.');
})();
