/**
 * APPLY — T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD (TTL 축소 fold 5/6)
 *   20260729120000_foot_redpay_planb_expires_default_5min.sql
 *   pending_payment.expires_at DEFAULT (now()+'10 minutes') → (now()+'5 minutes') + COMMENT×2.
 *
 * supervisor DDL-diff GO(MSG-20260729-084814-k823, verdict=GO) 위임 apply 절차:
 *   (a) PRE-probe: prod expires_at DEFAULT = '00:10:00' 실측(pre-apply 지문).
 *       불일치 시 OOB stomp 의심 → ABORT + 에스컬레이션(no apply).
 *   (b) dryrun 무영속 재실행(exit0) → 원자 apply(단일 txn, up.sql 내장 BEGIN/COMMIT)
 *       → ledger 기록(20260729120000; applyMigration 단일경로 = 적용+원장).
 *   (c) POST-probe: post-apply DEFAULT = '00:05:00' 실측 + ledger 등재 확인 → evidence.
 *
 * 비파괴(SET DEFAULT + COMMENT only, prod pending_payment 0-row) · 멱등(절대값 지정).
 * 실행: node scripts/apply_20260729120000_foot_redpay_planb_expires_default_5min.mjs [--apply]
 *   (--apply 미지정 = PRE-probe + dryrun 까지만, prod DDL write 없음)
 * author: dev-foot / 2026-07-29
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { query, applyMigration, ledgerVersions } from './lib/foot_migration_ledger.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dir, '..');
const APPLY = process.argv.includes('--apply');

const VERSION = '20260729120000';
const FILE = '20260729120000_foot_redpay_planb_expires_default_5min.sql';
const DRYRUN_MJS = join(REPO_ROOT, 'supabase/migrations/20260729120000_foot_redpay_planb_expires_default_5min.dryrun.mjs');

const DEFAULT_SQL = `SELECT COALESCE(pg_get_expr(d.adbin, d.adrelid), '(none)') AS def
  FROM pg_attribute a
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attrelid = 'public.pending_payment'::regclass AND a.attname = 'expires_at';`;

const ROWCOUNT_SQL = `SELECT count(*)::int AS n FROM public.pending_payment;`;

async function readDefault() {
  const rows = await query(DEFAULT_SQL);
  return (Array.isArray(rows) ? rows[0]?.def : rows?.def) || '(none)';
}

console.log(`── REDPAY-PLANB TTL fold DEFAULT apply (${APPLY ? 'APPLY' : 'PRE+DRYRUN only'}) — ${VERSION} ──`);

// ── (a) PRE-probe: prod 지문 = expires_at DEFAULT '00:10:00' (w5rs 최초 ADDITIVE 값) ──
const preDefault = await readDefault();
const preRows = await query(ROWCOUNT_SQL);
const preN = (Array.isArray(preRows) ? preRows[0]?.n : preRows?.n) ?? -1;
console.log(`\n[PRE] expires_at DEFAULT = ${preDefault}`);
console.log(`[PRE] pending_payment row count = ${preN}`);

if (!/00:10:00/.test(preDefault)) {
  console.error(`\n✗ ABORT: PRE DEFAULT 지문 불일치 — 기대='00:10:00' 포함, 실측='${preDefault}'.`);
  console.error(`  OOB stomp 의심 → apply 중단, supervisor 에스컬레이션 필요.`);
  process.exit(2);
}
console.log(`[PRE] ✓ 지문 정합 (10분 DEFAULT) — OOB stomp 없음.`);

// ── (b1) dryrun 무영속 재실행 (exit0 요구) ──
console.log(`\n[DRYRUN] node ${DRYRUN_MJS}`);
const dr = spawnSync('node', [DRYRUN_MJS], { cwd: REPO_ROOT, stdio: 'inherit', env: process.env });
if (dr.status !== 0) {
  console.error(`\n✗ ABORT: dryrun exit=${dr.status} (≠0) — 무영속 검증 실패. apply 중단.`);
  process.exit(3);
}
console.log(`[DRYRUN] ✓ exit0 — 무영속 PASS.`);

// dryrun 후 prod DEFAULT 가 여전히 10분(무영속 재확인)
const afterDryrun = await readDefault();
if (!/00:10:00/.test(afterDryrun)) {
  console.error(`\n✗ ABORT: dryrun 후 DEFAULT 오염='${afterDryrun}' (무영속 위반). apply 중단.`);
  process.exit(4);
}
console.log(`[DRYRUN] ✓ post-dryrun DEFAULT 여전히 10분 (무영속 실측 확인).`);

if (!APPLY) {
  console.log(`\n[dry-run mode] --apply 미지정 → prod DDL/원장 write 없음. 종료(exit0).`);
  process.exit(0);
}

// ── (b2) 원자 apply (단일 txn) + ledger 기록 (applyMigration 단일경로) ──
console.log(`\n[APPLY] applyMigration ${FILE} (단일 txn + ledger ${VERSION})`);
const res = await applyMigration({
  version: VERSION,
  file: FILE,
  dryRun: false,
  createdBy: 'T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD-ttl-fold-5min',
});
console.log(`[APPLY] ✓ applied=${res.applied} name=${res.name}`);

// ── (c) POST-probe: DEFAULT '00:05:00' 실측 + ledger 등재 ──
const postDefault = await readDefault();
const led = await ledgerVersions();
const ledgerHas = led.has(VERSION);
console.log(`\n[POST] expires_at DEFAULT = ${postDefault}`);
console.log(`[POST] ledger ${VERSION} = ${ledgerHas ? 'PRESENT' : 'ABSENT'}`);

const ok = /00:05:00/.test(postDefault) && ledgerHas;
console.log(`\nPOSTCHECK RESULT: ${ok ? 'PASS' : 'FAIL'}`);
if (!ok) {
  console.error(`  기대: DEFAULT '00:05:00' 포함 + ledger ${VERSION} PRESENT.`);
  process.exit(5);
}
console.log(`✓ DONE — DEFAULT 5분 정렬 + 원장 등재. app SSOT(redpayPlanbTtl.ts 5/6)와 fallback 정합.`);
console.log(`\n── EVIDENCE ──`);
console.log(JSON.stringify({
  version: VERSION,
  pre_default: preDefault,
  post_default: postDefault,
  pending_payment_rowcount: preN,
  ledger_recorded: ledgerHas,
  dryrun_exit0: true,
}, null, 2));
process.exit(0);
