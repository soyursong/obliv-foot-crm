// T-20260724-foot-REDPAY-DOSU-CONTAM-FIX 파트B — archive-first hard-DELETE apply 러너
//   (supervisor DB-GATE 실행용. DESTRUCTIVE — dev 자가적용 안 함.)
//
//   순서:
//     [gate]  freeze-set 재실측(=2) + FK-child 실자식 재실측(=0) — 어느 하나라도 어긋나면 ABORT.
//     [1단]   archive-first: _backup.redpay_dosu_contam_62071914_20260725 스냅샷 선적재 + 카운트 검증(=2).
//     [2단]   20260725140000_redpay_dosu_contam_delete.sql 적용(본체가 다시 freeze/FK/ROW_COUNT 가드).
//     [post]  삭제 후 잔여=0 재확인 + net 재집계 힌트 + ledger 기록.
//   DRY 기본. 실적용은 --apply.
//
//   ref: rxlomoozakkjesdqjtvd (foot prod). 선례: T-20260718-...-DAEWOONG-PLURANAZOLE-REMOVE_apply / WS-C.
import { query, applyMigration, recordLedger } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const MODE = APPLY ? 'APPLY(실적용)' : 'DRY(계획만)';
const nowKst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';
const VERSION = '20260725140000';
const FILE = '20260725140000_redpay_dosu_contam_delete.sql';

const WHERE = `approval_no = '62071914' AND (raw_payload->'merchant'->>'id') = '1777276003' AND (raw_payload->>'_mode') IS DISTINCT FROM 'observe'`;

const scalar = async (sql) => {
  const rows = await query(sql);
  const r = (Array.isArray(rows) ? rows : [])[0] || {};
  return r[Object.keys(r)[0]];
};

console.log('════════════════════════════════════════════════════════════');
console.log(`[${MODE}] REDPAY-DOSU-CONTAM-FIX 파트B — 도수 2행 archive-first hard-DELETE (${nowKst()})`);
console.log('  ref rxlomoozakkjesdqjtvd · approval_no=62071914 · merchant=1777276003');
console.log('════════════════════════════════════════════════════════════\n');

// ── [gate] freeze-set + FK-child 재실측 ──
const freeze = await scalar(`SELECT count(*)::int AS n FROM public.redpay_raw_transactions WHERE ${WHERE};`);
console.log(`── [gate] freeze-set 재실측 = ${freeze} (기대=2)`);
if (freeze !== 2) {
  console.error(`\n⛔ ABORT — freeze-set ${freeze} 행(기대=2). 대상 드리프트/대상 외 혼입 → 재-freeze·supervisor 보고.`);
  process.exit(2);
}
const fkRecon = await scalar(
  `SELECT count(*)::int AS n FROM public.payment_reconciliation_log l ` +
  `WHERE l.raw_transaction_id IN (SELECT id FROM public.redpay_raw_transactions WHERE ${WHERE});`,
);
let fkPending = 0;
const hasPending = await scalar(`SELECT (to_regclass('public.foot_redpay_planb_pending_payment') IS NOT NULL) AS n;`);
if (hasPending) {
  fkPending = await scalar(
    `SELECT count(*)::int AS n FROM public.foot_redpay_planb_pending_payment p ` +
    `WHERE p.matched_raw_txid IN (SELECT id FROM public.redpay_raw_transactions WHERE ${WHERE});`,
  );
}
console.log(`── [gate] FK-child 실자식: payment_reconciliation_log=${fkRecon} foot_redpay_planb_pending_payment=${fkPending}`);
if ((fkRecon + fkPending) !== 0) {
  console.error(`\n⛔ ABORT — FK-child 실자식 존재(합산=${fkRecon + fkPending}). de-minimis 무효 → 대표게이트 재개(재-CONSULT). hard-DELETE 금지.`);
  process.exit(2);
}
console.log('  ✅ SAFE — freeze=2, FK-child=0 (de-minimis 유지). 진행.\n');

if (!APPLY) {
  console.log('── [DRY] 계획: [1단] _backup 스냅샷 → [2단] ' + FILE + ' 적용 → [post] 잔여 0 확인');
  console.log('실적용: --apply 플래그.\n');
  process.exit(0);
}

// ── [1단] archive-first _backup 스냅샷 (파괴 前 필수) ──
console.log('── [1단] archive-first _backup 스냅샷 ──');
await query(`CREATE SCHEMA IF NOT EXISTS _backup;`);
await query(
  `CREATE TABLE IF NOT EXISTS _backup.redpay_dosu_contam_62071914_20260725 AS ` +
  `SELECT * FROM public.redpay_raw_transactions WHERE ${WHERE};`,
);
const snap = await scalar(`SELECT count(*)::int AS n FROM _backup.redpay_dosu_contam_62071914_20260725;`);
console.log(`  스냅샷 카운트 = ${snap} (기대=2)`);
if (snap < 2) {
  console.error(`\n⛔ ABORT — 스냅샷 ${snap} 행(<2). archive 부실 → 롤백 원복 불가 위험. 파괴 금지.`);
  process.exit(2);
}
console.log('  ✅ archive 확보.\n');

// ── [2단] up.sql 적용 (본체 freeze/FK/ROW_COUNT 가드 재실행) ──
console.log('── [2단] up.sql 적용 ──');
await applyMigration({ version: VERSION, file: FILE, dryRun: false, createdBy: 'dev-foot-DOSU-CONTAM-FIX' });

// ── [post] 잔여 0 재확인 ──
const remain = await scalar(`SELECT count(*)::int AS n FROM public.redpay_raw_transactions WHERE ${WHERE};`);
console.log(`\n── [post] 삭제 후 도수 오염 잔여 = ${remain} (기대=0)`);
if (remain !== 0) {
  console.error(`⚠ 잔여 ${remain} 행 — 삭제 미완. supervisor 확인.`);
  process.exit(2);
}
await recordLedger({ version: VERSION, name: FILE, createdBy: 'dev-foot-DOSU-CONTAM-FIX', dryRun: false });
console.log('  ✅ 도수 오염 2행 hard-DELETE 완료 · 잔여 0 · ledger 기록.');
console.log('  → 파트A merchant-drop 배포 후 7/23 daily_full 재pull 시 도수 재유입 0 재현으로 재발방지 확인.');
