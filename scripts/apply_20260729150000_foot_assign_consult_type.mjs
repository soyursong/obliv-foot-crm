/**
 * APPLY — T-20260726-foot-ASSIGN-CONSULTTYPE-DROPDOWN (배정 상담유형 4종 저장모델)
 *   20260729150000_foot_assign_consult_type.sql
 *   check_ins 에 assignment_consult_type TEXT NULL ADDITIVE + named CHECK chk_check_ins_assignment_consult_type.
 *
 * supervisor DDL-diff QA 게이트 선행 위임 apply 절차(dev-foot 직접 pg 적용):
 *   (a) PRE-probe: prod check_ins 에 assignment_consult_type 컬럼 **부재** 실측(pre-apply 지문).
 *       이미 존재 시 = OOB stomp/이중적용 의심 → ABORT(no apply, supervisor 에스컬레이션).
 *   (b) dryrun 무영속 재실행(exit0) → 원자 apply(단일 txn, up.sql 내장 BEGIN/COMMIT)
 *       → ledger 기록(20260729150000; applyMigration 단일경로 = 적용+원장).
 *   (c) POST-probe: post-apply 컬럼+CHECK 존재 실측 + ledger 등재 확인 → evidence.
 *
 * 비파괴(ADD COLUMN nullable + CHECK only) · 멱등(IF NOT EXISTS / DO-guard).
 * 실행: node scripts/apply_20260729150000_foot_assign_consult_type.mjs [--apply]
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

const VERSION = '20260729150000';
const FILE = '20260729150000_foot_assign_consult_type.sql';
const DRYRUN_MJS = join(REPO_ROOT, 'supabase/migrations/20260729150000_foot_assign_consult_type.dryrun.mjs');

const COL_SQL = `SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'check_ins'
       AND column_name = 'assignment_consult_type'
  ) AS present;`;
const CHK_SQL = `SELECT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.check_ins'::regclass
       AND conname = 'chk_check_ins_assignment_consult_type'
  ) AS present;`;

async function boolOf(sql) {
  const rows = await query(sql);
  return (Array.isArray(rows) ? rows[0]?.present : rows?.present) === true;
}

console.log(`── ASSIGN-CONSULTTYPE-DROPDOWN column apply (${APPLY ? 'APPLY' : 'PRE+DRYRUN only'}) — ${VERSION} ──`);

// ── (a) PRE-probe: prod 지문 = 컬럼 부재 ──
const preCol = await boolOf(COL_SQL);
const preChk = await boolOf(CHK_SQL);
console.log(`\n[PRE] assignment_consult_type column present = ${preCol}`);
console.log(`[PRE] chk_check_ins_assignment_consult_type present = ${preChk}`);
if (preCol || preChk) {
  console.error(`\n✗ ABORT: PRE 지문 불일치 — 컬럼/제약이 이미 존재. 이중적용/OOB stomp 의심 → apply 중단, supervisor 에스컬레이션.`);
  process.exit(2);
}
console.log(`[PRE] ✓ 지문 정합 (컬럼·제약 부재) — 신규 ADDITIVE.`);

// ── (b1) dryrun 무영속 재실행 (exit0 요구) ──
console.log(`\n[DRYRUN] node ${DRYRUN_MJS}`);
const dr = spawnSync('node', [DRYRUN_MJS], { cwd: REPO_ROOT, stdio: 'inherit', env: process.env });
if (dr.status !== 0) {
  console.error(`\n✗ ABORT: dryrun exit=${dr.status} (≠0) — 무영속 검증 실패. apply 중단.`);
  process.exit(3);
}
console.log(`[DRYRUN] ✓ exit0 — 무영속 PASS.`);

// dryrun 후 컬럼 여전히 부재(무영속 재확인)
const afterDryrunCol = await boolOf(COL_SQL);
if (afterDryrunCol) {
  console.error(`\n✗ ABORT: dryrun 후 컬럼 영속됨(무영속 위반). apply 중단.`);
  process.exit(4);
}
console.log(`[DRYRUN] ✓ post-dryrun 컬럼 여전히 부재 (무영속 실측 확인).`);

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
  createdBy: 'T-20260726-foot-ASSIGN-CONSULTTYPE-DROPDOWN',
});
console.log(`[APPLY] ✓ applied=${res.applied} name=${res.name}`);

// ── (c) POST-probe: 컬럼+CHECK 존재 + ledger 등재 ──
const postCol = await boolOf(COL_SQL);
const postChk = await boolOf(CHK_SQL);
const led = await ledgerVersions();
const ledgerHas = led.has(VERSION);
console.log(`\n[POST] assignment_consult_type column present = ${postCol}`);
console.log(`[POST] chk_check_ins_assignment_consult_type present = ${postChk}`);
console.log(`[POST] ledger ${VERSION} = ${ledgerHas ? 'PRESENT' : 'ABSENT'}`);

const ok = postCol && postChk && ledgerHas;
console.log(`\nPOSTCHECK RESULT: ${ok ? 'PASS' : 'FAIL'}`);
if (!ok) {
  console.error(`  기대: 컬럼 present + CHECK present + ledger ${VERSION} PRESENT.`);
  process.exit(5);
}
console.log(`✓ DONE — assignment_consult_type ADDITIVE 적용 + 원장 등재.`);
console.log(`\n── EVIDENCE ──`);
console.log(JSON.stringify({
  version: VERSION,
  pre_column_present: preCol,
  post_column_present: postCol,
  post_check_present: postChk,
  ledger_recorded: ledgerHas,
  dryrun_exit0: true,
}, null, 2));
process.exit(0);
