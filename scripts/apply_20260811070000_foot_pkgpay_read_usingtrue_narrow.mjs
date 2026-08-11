/**
 * apply_20260811070000_foot_pkgpay_read_usingtrue_narrow.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * 티켓: T-20260811-foot-PKGPAY-READ-USINGTRUE-NARROW
 * 게이트: supervisor DB-GATE GO-token (ed25519, key_id supv-dbgate-2026a).
 *   ⚠ GO-token 前 prod DDL 선집행 금지(deploy-precheck C20 · apply_before_go).
 *   apply = supervisor DB-GATE lane. GO-token(.json+.sig) 검증 후에만 prod COMMIT.
 * 대상 마이그: supabase/migrations/20260811070000_foot_pkgpay_read_usingtrue_narrow.sql
 *   exposure-REDUCING(§72): package_payments_read permissive SELECT
 *   USING(true) → USING(is_approved_user()) in-place 재정의(DROP self + CREATE).
 *   RESTRICTIVE tenant_isolation(clinic_id, 20260810200000) UNCHANGED.
 *   내장 PREFLIGHT(대상실재·RLS ENABLE·술어함수 실재·현행 USING=true drift-guard·
 *   RESTRICTIVE tenant 존치) + VERIFY(is_approved_user() 포함·잔여 true 0·
 *   USING(true) permissive read 잔존 0·RESTRICTIVE tenant 존치·approved_read 존치).
 *
 * 실행:
 *   node scripts/apply_20260811070000_foot_pkgpay_read_usingtrue_narrow.mjs          # PRE-PROBE only(비 apply)
 *   node scripts/apply_20260811070000_foot_pkgpay_read_usingtrue_narrow.mjs --apply  # gate → apply → POST-PROBE
 */
import { join, dirname } from 'node:path';
import { readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { query, applyMigration, MIG_DIR } from './lib/foot_migration_ledger.mjs';
import { assertApplyGateForRunner, applyTimingSelfCheck, FOOT_PROD_REF } from './apply_gate_lib.mjs';
import { migrationSha256 } from './apply_gate_lib.mjs';

const APPLY = process.argv.includes('--apply');
const VERSION = '20260811070000';
const FILE = '20260811070000_foot_pkgpay_read_usingtrue_narrow.sql';
const TICKET_ID = 'T-20260811-foot-PKGPAY-READ-USINGTRUE-NARROW';
const REF = FOOT_PROD_REF;
const __dir = dirname(fileURLToPath(import.meta.url));
const RUNNER_LOG = join(__dir, '../db-gate/_apply_evidence/runner_apply.log.jsonl');
const EVIDENCE_LOG = join(__dir, '../db-gate/_apply_evidence/apply_evidence.jsonl');
const SQL_FILE = join(MIG_DIR, FILE);

async function qsafe(name, sql) {
  try { const r = await query(sql); console.log(`  [${name}]`, JSON.stringify(r)); return r; }
  catch (e) { console.log(`  [${name}] (query error)`, e.message); return null; }
}

async function structuralProbe(label) {
  console.log(`\n══════════ ${label} ══════════`);
  await qsafe('policies (package_payments)', `SELECT policyname, cmd, permissive, roles::text roles,
      left(qual,56) qual, left(with_check,40) with_check
    FROM pg_policies WHERE schemaname='public' AND tablename='package_payments'
    ORDER BY permissive DESC, policyname`);
  await qsafe('package_payments_read USING (pre: true / post: is_approved_user())', `SELECT
      btrim(coalesce(pg_get_expr(po.polqual, po.polrelid),'')) AS read_using
    FROM pg_policy po JOIN pg_class c ON c.oid=po.polrelid
    WHERE c.relname='package_payments' AND po.polname='package_payments_read'`);
  await qsafe('USING(true) permissive read residual (pre:1 / post:0)', `SELECT count(*) n
    FROM pg_policy po JOIN pg_class c ON c.oid=po.polrelid
    WHERE c.relname='package_payments' AND po.polpermissive AND po.polcmd IN ('r','*')
      AND btrim(coalesce(pg_get_expr(po.polqual, po.polrelid),'')) = 'true'`);
  await qsafe('RESTRICTIVE tenant_isolation count (invariant: 1)', `SELECT count(*) n FROM pg_policies
    WHERE schemaname='public' AND tablename='package_payments'
      AND policyname='package_payments_tenant_isolation' AND permissive='RESTRICTIVE'`);
  await qsafe('canonical approved_read count (invariant: 1)', `SELECT count(*) n FROM pg_policies
    WHERE schemaname='public' AND tablename='package_payments'
      AND policyname='package_payments_approved_read'`);
}

(async () => {
  await structuralProbe('PRE-PROBE (apply 전 현재 상태)');
  if (!APPLY) {
    console.log('\n(PRE-PROBE only) --apply 미지정 → prod 무변경. GO-token 검증 후 --apply 재실행.');
    return;
  }
  // ── DB-GATE: GO-token 검증(prod lane 필수). 부재/불일치/만료 → abort ──
  const migrationSql = readFileSync(SQL_FILE, 'utf8');
  const gate = assertApplyGateForRunner({
    ticketId: TICKET_ID, targetRef: REF, applyRequested: true,
    migrationSqlFile: SQL_FILE, evidenceLog: RUNNER_LOG,
  });
  console.log('\n[DB-GATE] GO-token 검증 통과:', JSON.stringify(gate.gate ?? gate));

  // ── apply evidence 3필드 (C20 apply_before_go) ──
  const applyTsMs = Date.now();
  const selfCheck = applyTimingSelfCheck(gate.gate, applyTsMs);
  console.log('\n[EVIDENCE] apply timing self-check:', JSON.stringify(selfCheck));
  if (selfCheck.anomaly) {
    throw new Error('SELF-CHECK abort: apply_ts < go_issued_at (apply_before_go 지문) — apply 중단.');
  }
  if (applyTsMs > Date.parse(gate.gate.expiresAt)) {
    throw new Error(`TTL abort: apply_ts(${new Date(applyTsMs).toISOString()}) > expires_at(${gate.gate.expiresAt}) — supervisor 재서명 필요.`);
  }

  // ── prod COMMIT (ledger 경유 apply) ──
  console.log('\n[APPLY] prod COMMIT 시작…');
  const r = await applyMigration({ version: VERSION, file: FILE, dryRun: false, createdBy: 'dev-foot:'+TICKET_ID });
  console.log('[APPLY] 완료:', JSON.stringify(r));

  // ── apply evidence 3필드 기록(go_token_path · go_issued_at · apply_ts) ──
  const evRec = {
    ticket_id: TICKET_ID, lane: 'prod', target_ref: REF,
    sql_sha256: migrationSha256(migrationSql),
    go_token_path: gate.gate.tokenPath,
    go_issued_at: gate.gate.issuedAt,
    apply_ts: new Date(applyTsMs).toISOString(),
    expires_at: gate.gate.expiresAt,
    status: 'applied', dry_run: false,
    guard: 'assertApplyGateForRunner+apply_claim_guard.sh', schema_version: 1,
  };
  mkdirSync(dirname(EVIDENCE_LOG), { recursive: true });
  appendFileSync(EVIDENCE_LOG, JSON.stringify(evRec) + '\n');
  console.log('\n[EVIDENCE] 3필드 기록:', JSON.stringify(evRec));

  await structuralProbe('POST-PROBE (structural POSTCHECK)');
  // schema_migrations 착지 확인
  await qsafe('schema_migrations ledger (expect version present)', `SELECT version, name, created_by
    FROM supabase_migrations.schema_migrations WHERE version='${VERSION}'`);
  console.log('\n※ apply-후 POSTCHECK(narrow 착지·USING(true) permissive read 잔존0·RESTRICTIVE tenant/approved_read 존치·승인 스태프 read 지속·비활성 계정 read 상실) = supervisor 사후검증.');
})();
