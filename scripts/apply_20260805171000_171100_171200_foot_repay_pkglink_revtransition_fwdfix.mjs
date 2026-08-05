/**
 * apply_20260805171000_171100_171200_foot_repay_pkglink_revtransition_fwdfix.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * 티켓: T-20260805-foot-REPAY-PKGLINK-REVTRANSITION-FWDFIX
 * 게이트: supervisor DB-GATE GO (MSG-20260805-163509-woxi apply 인가)
 *   pin commit 6dad9753 · migration_sha256(combined)=34142f88…
 *
 * 3-마이그 원자 배포 (apply 순서 = 토큰 apply_order):
 *   ① 171000 §2 트리거 (foot_recompute_package_status + writer-agnostic 트리거 2)
 *   ② 171100 §3 refund 단방향가드 제거 (REVTRANSITION-FWDFIX-DELEGATE)
 *   ③ 171200 §1 record_planb pkglink (p_package_id 스레딩)
 *
 * 계약(_TEMPLATE_apply_runner_gated.mjs 승계):
 *   · content-binding = 3파일 concat(구분자 없음, 171000∥171100∥171200) sha256
 *     == 토큰 migration_sha256. 단일 chokepoint(assertApplyGateForRunner) 통과 후에만 COMMIT.
 *   · 각 파일은 applyMigration() 경유 → DDL 적용 + schema_migrations 원장 row 기록(3 row).
 *   · evidenceLog 에 C20 사후감지 evidence append.
 *
 * 실행:
 *   node scripts/apply_20260805171000_171100_171200_foot_repay_pkglink_revtransition_fwdfix.mjs --dry
 *   node scripts/apply_20260805171000_171100_171200_foot_repay_pkglink_revtransition_fwdfix.mjs --apply
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assertApplyGateForRunner, FOOT_PROD_REF } from './apply_gate_lib.mjs';
import { applyMigration, MIG_DIR } from './lib/foot_migration_ledger.mjs';

const TICKET_ID = 'T-20260805-foot-REPAY-PKGLINK-REVTRANSITION-FWDFIX';
const REF = FOOT_PROD_REF;
const APPLY = process.argv.includes('--apply');
const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_LOG = join(__dirname, '../db-gate/_apply_evidence/runner_apply.log.jsonl');

// apply 순서 = 토큰 apply_order (§2 → §3 → §1)
const STEPS = [
  { version: '20260805171000', file: '20260805171000_foot_package_status_crossledger_trigger.sql', tag: '§2 트리거' },
  { version: '20260805171100', file: '20260805171100_foot_refund_package_payment_delegate_status.sql', tag: '§3 refund 단방향가드 제거' },
  { version: '20260805171200', file: '20260805171200_foot_record_planb_pkglink.sql', tag: '§1 record_planb pkglink' },
];

// content-binding: 3파일 concat(구분자 없음) — 토큰 migration_sha256 산식과 동일
const combinedSql = STEPS.map((s) => readFileSync(join(MIG_DIR, s.file), 'utf8')).join('');

if (!APPLY) {
  console.log(`(DRY) ${TICKET_ID} — 3-마이그 배포 계획:`);
  STEPS.forEach((s, i) => console.log(`   ${i + 1}) ${s.version} ${s.tag}  (${s.file})`));
  console.log('   → supervisor DB-GATE GO-token 게이트 통과 후 --apply.');
  process.exit(0);
}

// ── APPLY 게이트 chokepoint (A∧C content-binding; combined SQL) ────────────────
try {
  const gate = assertApplyGateForRunner({
    ticketId: TICKET_ID,
    targetRef: REF,
    applyRequested: APPLY,
    migrationSql: combinedSql,
    evidenceLog: EVIDENCE_LOG,
  });
  console.log(`✔ DB-GATE GO 통과 — go_issued_at=${gate.gate.issuedAt} sql_sha256=${gate.gate.migrationSha256}`);
} catch (e) {
  console.error(`❌ APPLY-GATE 거부 [${e.code}]: ${e.message}\n   → COMMIT 미도달(abort).`);
  process.exit(1);
}

// ── APPLY (게이트 통과 후에만 도달) — 순서 보존, 각 단계 원장 기록 ────────────────
console.log('\nAPPLY (순서 §2→§3→§1) ...');
for (const s of STEPS) {
  process.stdout.write(`   apply ${s.version} ${s.tag} ... `);
  const r = await applyMigration({
    version: s.version,
    file: s.file,
    dryRun: false,
    createdBy: TICKET_ID,
  });
  console.log(`✅ (ledger recorded: ${r.applied})`);
}
console.log('\n✅ 3-마이그 적용 완료 + schema_migrations 3 row 기록.');
