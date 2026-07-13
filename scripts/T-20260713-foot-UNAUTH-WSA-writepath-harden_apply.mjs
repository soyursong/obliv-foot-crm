/**
 * T-20260713-foot-UNAUTH-CHANGE-INVESTIGATE-ROLLBACK (WS-A) — PROD APPLY
 *   self_checkin_with_reservation_link WRITE-path 하드닝 마이그레이션 실적용.
 *
 * supervisor DB-GATE 사전 승인(MSG-20260713-125902-y9sy):
 *   deploy_commit 798a2281 / mig_commit 757165d6 / forward ed8550ea — 3개 모두 origin/main ancestor.
 *   MIG-GATE 4필드 충족(mig_files/mig_dryrun pass/mig_ledger_check net-new/mig_rollback).
 *   마이그=CREATE OR REPLACE FN + GRANT + COMMENT 전부 txn-safe(비-txn DDL 0). 롤백=직전 20260617 함수정의.
 *
 * 실행: apply → schema_migrations 정직 등재(applyMigration 단일 경로) → post-verify(지문 present + ledger).
 * 사용: SUPABASE_ACCESS_TOKEN=… node scripts/T-20260713-foot-UNAUTH-WSA-writepath-harden_apply.mjs
 */
import { applyMigration, query } from './lib/foot_migration_ledger.mjs';

const FN = 'self_checkin_with_reservation_link';
const FP = 'unlinked_masking_hold'; // WS-A 지문 (신 정의에만 존재)
const VERSION = '20260713120000';
const FILE = '20260713120000_selfcheckin_writepath_harden_masked_reject.sql';

const defOf = async () => {
  const rows = await query(
    `SELECT pg_get_functiondef(p.oid) AS def
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='${FN}' LIMIT 1`
  );
  return rows[0]?.def || '';
};

// ── (0) baseline ──
const baseline = await defOf();
console.log(`── (0) baseline: fn 존재=${!!baseline} · WS-A지문(${FP}) present=${baseline.includes(FP)}`);

// ── (1) apply (txn-safe: SQL 내장 BEGIN;…COMMIT;) + schema_migrations 정직 등재 ──
const res = await applyMigration({
  version: VERSION,
  file: FILE,
  dryRun: false,
  createdBy: 'dev-foot:T-20260713-foot-UNAUTH-CHANGE-INVESTIGATE-ROLLBACK',
});
console.log('── (1) applyMigration:', JSON.stringify(res));

// ── (2) post-verify: 함수정의에 WS-A 지문 present ──
const post = await defOf();
const postHasFp = post.includes(FP);
console.log(`── (2) post-verify: WS-A지문(${FP}) prod 영속 present=${postHasFp}`);

// ── (3) ledger 정직 등재 확인 ──
const led = await query(
  `SELECT version, name, created_by FROM supabase_migrations.schema_migrations WHERE version='${VERSION}'`
);
console.log('── (3) schema_migrations:', JSON.stringify(led));

const ok = postHasFp && Array.isArray(led) && led.length === 1;
console.log(`\n===== APPLY 판정: ${ok ? '✅ GO (지문 present + ledger 등재)' : '❌ FAIL'} =====`);
process.exit(ok ? 0 : 1);
