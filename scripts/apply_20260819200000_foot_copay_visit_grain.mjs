/**
 * apply_20260819200000_foot_copay_visit_grain.mjs
 * 티켓: T-20260819-foot-COPAY-VISIT-GRAIN (design A · ADDITIVE money-billing DDL)
 * 정본 템플릿: scripts/_TEMPLATE_apply_runner_gated.mjs
 * 실행: pinned-worktree(bb7980d4) fail-closed 러너.
 *   node scripts/apply_20260819200000_foot_copay_visit_grain.mjs           # PRE-PROBE(무영속)
 *   node scripts/apply_20260819200000_foot_copay_visit_grain.mjs --apply   # GO-token 게이트 통과 후 apply
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertApplyGateForRunner, FOOT_PROD_REF } from './apply_gate_lib.mjs';
import { applyMigration, MIG_DIR } from './lib/foot_migration_ledger.mjs';

const TICKET_ID = 'T-20260819-foot-COPAY-VISIT-GRAIN';
const REF       = FOOT_PROD_REF;
const VERSION   = '20260819200000';
const FILE      = '20260819200000_foot_calc_visit_copayment_additive.sql';
const APPLY     = process.argv.includes('--apply');

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_LOG = join(__dirname, '../db-gate/_apply_evidence/runner_apply.log.jsonl');
const SQL_FILE = join(MIG_DIR, FILE);

if (!APPLY) {
  console.log('(DRY) --apply 미지정 → PRE-PROBE. supervisor GO-token 게이트 통과 후 --apply.');
  console.log('SQL_FILE =', SQL_FILE);
  process.exit(0);
}

// ── APPLY 게이트 chokepoint (삭제/우회 금지) ──
try {
  assertApplyGateForRunner({
    ticketId: TICKET_ID,
    targetRef: REF,
    applyRequested: APPLY,
    migrationSqlFile: SQL_FILE,
    evidenceLog: EVIDENCE_LOG,
  });
} catch (e) {
  console.error(`❌ APPLY-GATE 거부 [${e.code}]: ${e.message}\n   → GO-token 부재/무효/만료. COMMIT 미도달(abort).`);
  process.exit(1);
}

console.log('\nAPPLY ...');
const res = await applyMigration({ version: VERSION, file: FILE, dryRun: false, createdBy: `dev-foot:${TICKET_ID}` });
console.log('✅ 적용 완료:', JSON.stringify(res));
