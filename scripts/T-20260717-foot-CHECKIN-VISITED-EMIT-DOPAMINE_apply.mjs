/**
 * T-20260717-foot-CHECKIN-VISITED-EMIT-DOPAMINE — visited_stage mig 20260718120000 선택 apply
 * supervisor 조건부 GO (MSG-20260718-024858-t5ug, DDL-diff=ADDITIVE 사전승인).
 *
 * ── 진행 요청 (supervisor) ──
 *   1) mig 20260718120000 **선택 apply** — bulk `db push` 금지(130000 이미 ledger). Mgmt-API 선택 apply.
 *   2) POSTCHECK 3건 실측 회신:
 *      (a) event_type CHECK 에 visited_stage 등재 (6값)
 *      (b) enqueue_dopamine_visited_stage pg_proc 실재
 *      (c) trg_dopamine_cb_checkin_stage on check_ins 실재 + 기존 trg_dopamine_cb_checkin 무손상(n=1)
 *   3) applied_at + POSTCHECK 결과 frontmatter 기입 (DDL-ATOMIC 증적).
 *
 * ── 단일경로 apply = 원장 기록 ──
 *   applyMigration() 경유 = SQL 적용 + schema_migrations 원장 idempotent INSERT (drift 재발 차단).
 *   bulk db push 미사용 → 130000(이미 적용) 무접촉, 120000 만 선택 apply.
 *
 * usage: node scripts/T-20260717-...apply.mjs          (DRY — BEFORE 실측만)
 *        node scripts/T-20260717-...apply.mjs --apply  (실적용 + POSTCHECK)
 * PROD write = supervisor 조건부 GO 경유.
 * author: dev-foot / 2026-07-18
 */
import { query, applyMigration, ledgerVersions } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const MODE = APPLY ? 'APPLY(실적용)' : 'DRY(BEFORE 실측만)';
const VERSION = '20260718120000';
const FILE = '20260718120000_foot_checkin_visited_stage_emit.sql';
const nowKst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';

const scalar = async (sql) => {
  const rows = await query(sql);
  const r = (Array.isArray(rows) ? rows : [])[0] || {};
  return r[Object.keys(r)[0]];
};

// ── probe helpers ──
const getCheckDef = () => scalar(
  `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
   WHERE conname = 'dopamine_callback_outbox_event_type_check';`);
const getFuncExists = () => scalar(
  `SELECT count(*)::int AS n FROM pg_proc
   WHERE proname = 'enqueue_dopamine_visited_stage'
     AND pronamespace = 'public'::regnamespace;`);
const getTrigStage = () => scalar(
  `SELECT count(*)::int AS n FROM pg_trigger
   WHERE tgname = 'trg_dopamine_cb_checkin_stage'
     AND tgrelid = 'public.check_ins'::regclass AND NOT tgisinternal;`);
const getTrigBase = () => scalar(
  `SELECT count(*)::int AS n FROM pg_trigger
   WHERE tgname = 'trg_dopamine_cb_checkin'
     AND tgrelid = 'public.check_ins'::regclass AND NOT tgisinternal;`);

console.log('════════════════════════════════════════════════════════════');
console.log(`[${MODE}] visited_stage mig ${VERSION} 선택 apply — ref rxlomoozakkjesdqjtvd (${nowKst()})`);
console.log('════════════════════════════════════════════════════════════\n');

// ── BEFORE 실측 ──
const ledgerBefore = await ledgerVersions();
console.log('── BEFORE (prod 실측) ──');
console.log(`  ledger has ${VERSION}? : ${ledgerBefore.has(VERSION)}`);
console.log(`  ledger has 20260718130000 (D1 worker mig)? : ${ledgerBefore.has('20260718130000')}`);
console.log(`  CHECK def         : ${await getCheckDef()}`);
console.log(`  enqueue_dopamine_visited_stage pg_proc n : ${await getFuncExists()}`);
console.log(`  trg_dopamine_cb_checkin_stage n          : ${await getTrigStage()}`);
console.log(`  trg_dopamine_cb_checkin (base) n         : ${await getTrigBase()}`);

if (!APPLY) {
  console.log('\n[DRY] 계획만. 실적용은 --apply. (bulk db push 금지 — applyMigration 단일 선택 apply)');
  process.exit(0);
}

// ── 게이트: 이미 적용됐으면 no-op ──
if (ledgerBefore.has(VERSION)) {
  console.log(`\n⚠ ${VERSION} 이미 ledger 존재 — 재apply 스킵(멱등). POSTCHECK 만 수행.`);
} else {
  console.log(`\n── APPLY ${VERSION} (applyMigration 단일경로: DDL + ledger) ──`);
  const res = await applyMigration({ version: VERSION, file: FILE, dryRun: false, createdBy: 'T-20260717-foot-CHECKIN-VISITED-EMIT' });
  console.log(`  applied: ${JSON.stringify(res)}`);
}
const appliedAt = nowKst();
console.log(`  applied_at = ${appliedAt}`);

// ── POSTCHECK 3건 실측 ──
console.log('\n════════════════════════════════════════════════════════════');
console.log('POSTCHECK (prod 실측)');
console.log('════════════════════════════════════════════════════════════');
const pcCheck = await getCheckDef();
const pcFunc = await getFuncExists();
const pcTrigStage = await getTrigStage();
const pcTrigBase = await getTrigBase();
const has6 = /visited_stage/.test(pcCheck || '');

console.log(`(a) CHECK def : ${pcCheck}`);
console.log(`    → visited_stage 등재(6값): ${has6 ? '✅ PASS' : '❌ FAIL'}`);
console.log(`(b) enqueue_dopamine_visited_stage pg_proc n=${pcFunc} : ${pcFunc === 1 ? '✅ PASS' : '❌ FAIL'}`);
console.log(`(c) trg_dopamine_cb_checkin_stage n=${pcTrigStage} : ${pcTrigStage === 1 ? '✅ PASS' : '❌ FAIL'}`);
console.log(`    기존 trg_dopamine_cb_checkin (base) n=${pcTrigBase} : ${pcTrigBase === 1 ? '✅ 무손상' : '❌ 손상!'}`);

const ledgerAfter = await ledgerVersions();
console.log(`\n  ledger has ${VERSION} (after) : ${ledgerAfter.has(VERSION) ? '✅' : '❌'}`);

const allPass = has6 && pcFunc === 1 && pcTrigStage === 1 && pcTrigBase === 1 && ledgerAfter.has(VERSION);
console.log(`\n${allPass ? '✅ ALL POSTCHECK PASS' : '❌ POSTCHECK FAIL — supervisor 보고'}`);
console.log(`applied_at(KST) = ${appliedAt}`);
process.exit(allPass ? 0 : 3);
