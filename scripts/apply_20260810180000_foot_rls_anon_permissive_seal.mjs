/**
 * apply_20260810180000_foot_rls_anon_permissive_seal.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * 티켓: T-20260810-foot-RLS-ANON-PERMISSIVE-SEAL
 * 게이트: supervisor DB-GATE GO-token (ed25519). ⚠ GO-token 前 prod DDL 선집행 금지(C20).
 *   apply = supervisor DB-GATE lane. GO-token(.json+.sig) 검증 후에만 prod COMMIT.
 * 대상 마이그: supabase/migrations/20260810180000_foot_rls_anon_permissive_seal.sql
 *   ADDITIVE RESTRICTIVE anon-deny x2 (services / package_tiers) — permissive 존치.
 *
 * 실행:
 *   node scripts/apply_20260810180000_foot_rls_anon_permissive_seal.mjs          # PRE-PROBE only(비 apply)
 *   node scripts/apply_20260810180000_foot_rls_anon_permissive_seal.mjs --apply  # gate → apply → POST-PROBE(structural+behavioral)
 */
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { query, applyMigration, MIG_DIR } from './lib/foot_migration_ledger.mjs';
import { assertApplyGateForRunner, FOOT_PROD_REF } from './apply_gate_lib.mjs';

const APPLY = process.argv.includes('--apply');
const VERSION = '20260810180000';
const FILE = '20260810180000_foot_rls_anon_permissive_seal.sql';
const TICKET_ID = 'T-20260810-foot-RLS-ANON-PERMISSIVE-SEAL';
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
  await qsafe('policies (services+package_tiers)', `SELECT tablename, policyname, cmd, permissive, roles::text roles,
      left(qual,40) qual, left(with_check,40) with_check
    FROM pg_policies WHERE schemaname='public' AND tablename IN ('services','package_tiers')
    ORDER BY tablename, permissive DESC, policyname`);
  await qsafe('restrictive anon-deny count (expect 2 post-apply)', `SELECT count(*) n FROM pg_policies
    WHERE schemaname='public' AND permissive='RESTRICTIVE' AND roles::text='{anon}'
      AND ((tablename='services' AND policyname='services_anon_deny')
        OR (tablename='package_tiers' AND policyname='package_tiers_anon_deny'))`);
  await qsafe('permissive anon-read residual (ADDITIVE: expect 2, untouched)', `SELECT count(*) n FROM pg_policies
    WHERE schemaname='public'
      AND ((tablename='services' AND policyname='anon_service_read')
        OR (tablename='package_tiers' AND policyname='anon_read_package_tiers'))`);
}

// behavioral anon-role RLS probe (guaranteed rollback — final RAISE aborts txn → no persistence).
// service_role count(>0) vs anon-role SELECT(=0) 대조로 "RLS 차단(빈테이블 아님)" 실증.
async function behavioralProbe() {
  console.log(`\n══════════ POST-PROBE (behavioral anon-role RLS · guaranteed rollback) ══════════`);
  const probe = `
DO $probe$
DECLARE res text := ''; c_svc int; c_pkg int;
BEGIN
  -- service_role(BYPASSRLS) 실 row 수 — 테이블 비어서 0이 나오는 게 아님을 대조 확립
  SELECT count(*) INTO c_svc FROM public.services;
  SELECT count(*) INTO c_pkg FROM public.package_tiers;
  res := res||'svc_total='||c_svc||';pkg_total='||c_pkg||';';

  -- anon 롤 컨텍스트 SELECT → RESTRICTIVE anon-deny 로 0 기대(테이블 비지 않았는데 0 = 차단 실효)
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  BEGIN SELECT count(*) INTO c_svc FROM public.services;        res:=res||'anon_svc='||c_svc||';';
  EXCEPTION WHEN insufficient_privilege THEN res:=res||'anon_svc=BLOCKED;'; WHEN others THEN res:=res||'anon_svc=ERR'||SQLSTATE||';'; END;
  BEGIN SELECT count(*) INTO c_pkg FROM public.package_tiers;   res:=res||'anon_pkg='||c_pkg||';';
  EXCEPTION WHEN insufficient_privilege THEN res:=res||'anon_pkg=BLOCKED;'; WHEN others THEN res:=res||'anon_pkg=ERR'||SQLSTATE||';'; END;

  RESET ROLE;
  RAISE EXCEPTION 'PROBE_ROLLBACK_OK :: %', res;  -- 무영속 rollback
END $probe$;`;
  await qsafe('anon-role probe (expect svc_total/pkg_total>0 & anon_svc=0 & anon_pkg=0)', probe);
  console.log('  ※ REST 계층 anon-key 실효 확인은 scripts/T-20260810-foot-RLS-ANON-PERMISSIVE-SEAL_postcheck.mjs 로 별도 실측');
}

(async () => {
  await structuralProbe('PRE-PROBE (apply 전 현재 상태)');
  if (!APPLY) {
    console.log('\n(PRE-PROBE only) --apply 미지정 → prod 무변경. GO-token 발행 후 --apply 재실행.');
    return;
  }
  // ── DB-GATE: GO-token 검증(prod lane 필수). 부재/불일치/만료 → abort ──
  const migrationSql = readFileSync(SQL_FILE, 'utf8');
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
  console.log('\n※ 이후 scripts/..._postcheck.mjs (anon-key REST 실효) + waiting_board/checklists 무접촉 회귀 확인 실행할 것.');
})();
