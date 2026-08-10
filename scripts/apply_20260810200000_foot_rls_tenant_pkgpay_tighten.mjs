/**
 * apply_20260810200000_foot_rls_tenant_pkgpay_tighten.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * 티켓: T-20260810-foot-RLS-TENANT-PKGPAY-TIGHTEN
 * 게이트: supervisor DB-GATE GO-token (ed25519, key_id supv-dbgate-2026a).
 *   ⚠ GO-token 前 prod DDL 선집행 금지(deploy-precheck C20 · apply_before_go).
 *   apply = supervisor DB-GATE lane. GO-token(.json+.sig) 검증 후에만 prod COMMIT.
 * 대상 마이그: supabase/migrations/20260810200000_foot_rls_tenant_pkgpay_tighten.sql
 *   ADDITIVE RESTRICTIVE tenant-isolation x1 (package_payments) — permissive 6종 존치.
 *   내장 PREFLIGHT(H3 NULL0 재확인·resolver 실재·멱등abort) + VERIFY(RESTRICTIVE/
 *   authenticated/ALL + USING&CHECK canonical + permissive>=6 ADDITIVE).
 *
 * 실행:
 *   node scripts/apply_20260810200000_foot_rls_tenant_pkgpay_tighten.mjs          # PRE-PROBE only(비 apply)
 *   node scripts/apply_20260810200000_foot_rls_tenant_pkgpay_tighten.mjs --apply  # gate → apply → POST-PROBE
 */
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { query, applyMigration, MIG_DIR } from './lib/foot_migration_ledger.mjs';
import { assertApplyGateForRunner, applyTimingSelfCheck, FOOT_PROD_REF } from './apply_gate_lib.mjs';

const APPLY = process.argv.includes('--apply');
const VERSION = '20260810200000';
const FILE = '20260810200000_foot_rls_tenant_pkgpay_tighten.sql';
const TICKET_ID = 'T-20260810-foot-RLS-TENANT-PKGPAY-TIGHTEN';
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
  await qsafe('policies (package_payments)', `SELECT policyname, cmd, permissive, roles::text roles,
      left(qual,48) qual, left(with_check,48) with_check
    FROM pg_policies WHERE schemaname='public' AND tablename='package_payments'
    ORDER BY permissive DESC, policyname`);
  await qsafe('restrictive tenant-isolation count (expect 1 post-apply)', `SELECT count(*) n FROM pg_policies
    WHERE schemaname='public' AND tablename='package_payments'
      AND policyname='package_payments_tenant_isolation'
      AND permissive='RESTRICTIVE' AND roles::text='{authenticated}' AND cmd='ALL'`);
  await qsafe('permissive residual (ADDITIVE: expect >=6, untouched)', `SELECT count(*) n FROM pg_policies
    WHERE schemaname='public' AND tablename='package_payments' AND permissive='PERMISSIVE'`);
  await qsafe('H3 NULL clinic_id (expect 0)', `SELECT count(*) n FROM public.package_payments WHERE clinic_id IS NULL`);
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
    migrationSqlFile: SQL_FILE, evidenceLog: EVIDENCE_LOG,
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

  await structuralProbe('POST-PROBE (structural POSTCHECK)');
  console.log('\n※ apply-후 QA1~5 coherence(cross-clinic 0-row / own-clinic read+write / NULL0 / own INSERT WITH CHECK / cross-clinic deny) = supervisor 사후검증.');
})();
