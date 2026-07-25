// T-20260724-foot-REDPAY-DOSU-CONTAM-FIX 파트B — child-first archive-first hard-DELETE apply 러너 (재작성)
//   (supervisor DB-GATE 실행용. DESTRUCTIVE — dev 자가적용 안 함.)
//
//   scope: 818행급 (recon_log child N[판정816/실측860 moving-target] + raw parent 2). child-first.
//   순서:
//     [gate]  parent 지문 재실측(=2) + 판정시점 명시 id 존재 + child scope 순도(payment_id NULL 전량·trxid 단일).
//     [1단]   archive-first: _backup 에 raw parent 2 + recon_log child N 스냅샷 선적재 + 카운트 검증.
//     [2단]   20260725140000_redpay_dosu_contam_delete.sql 적용(본체가 archive==delete·child-first·순소실0 가드).
//     [post]  parent 잔여=0 재확인 + residual child(archive後 신규) 계측(경고) + ledger 기록.
//   DRY 기본. 실적용은 --apply.
//
//   ⚠ CEO 5조건(Orphan-Row Archive-First Cleanup SOP):
//     1 archive-first 2단(archive行수==delete, 순소실0)  2 child-first(recon_log→raw, FK RESTRICT 가드)
//     3 대상셋 freeze(판정시점 id, DELETE직전 재검증, 불일치 abort)  4 DESTRUCTIVE→검증→ADDITIVE 분리
//     5 원장(payment/service_charges) 무접점(payment_id NOT NULL=0 계승)
//   ref: rxlomoozakkjesdqjtvd (foot prod). 선례: DAEWOONG-PLURANAZOLE-REMOVE / WS-C.
import { query, applyMigration, recordLedger } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const MODE = APPLY ? 'APPLY(실적용)' : 'DRY(계획만)';
const nowKst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';
const VERSION = '20260725140000';
const FILE = '20260725140000_redpay_dosu_contam_delete.sql';

const PARENT_WHERE =
  `approval_no = '62071914' AND (raw_payload->'merchant'->>'id') = '1777276003' ` +
  `AND (raw_payload->>'_mode') IS DISTINCT FROM 'observe'`;
const ARCH_RAW = '_backup.redpay_dosu_contam_raw_20260725';
const ARCH_CHILD = '_backup.redpay_dosu_contam_reconlog_20260725';

const scalar = async (sql) => {
  const rows = await query(sql);
  const r = (Array.isArray(rows) ? rows : [])[0] || {};
  return r[Object.keys(r)[0]];
};

console.log('════════════════════════════════════════════════════════════');
console.log(`[${MODE}] REDPAY-DOSU-CONTAM-FIX 파트B — child-first archive-first hard-DELETE (${nowKst()})`);
console.log('  ref rxlomoozakkjesdqjtvd · approval_no=62071914 · merchant=1777276003 · child-first(recon_log→raw)');
console.log('════════════════════════════════════════════════════════════\n');

// ── [gate] parent 지문 + 명시 id + child scope 순도 ──
const parentFp = await scalar(`SELECT count(*)::int AS n FROM public.redpay_raw_transactions WHERE ${PARENT_WHERE};`);
console.log(`── [gate] parent 지문 재실측 = ${parentFp} (기대=2)`);
if (parentFp !== 2) {
  console.error(`\n⛔ ABORT — parent 지문 ${parentFp} 행(기대=2). 대상 드리프트 → 재-freeze·supervisor 보고.`);
  process.exit(2);
}
const idsOk = await scalar(
  `SELECT count(*)::int AS n FROM public.redpay_raw_transactions ` +
  `WHERE id IN ('f5ca6ec5-9372-466d-9b12-39200ce6e1d0','60667463-e09b-4a2d-b98b-0175a7c7014c');`,
);
console.log(`── [gate] 판정시점 명시 parent id 존재 = ${idsOk} (기대=2)`);
if (idsOk !== 2) {
  console.error(`\n⛔ ABORT — 판정시점 명시 parent id ${idsOk}/2. freeze-set 불일치 → supervisor 보고.`);
  process.exit(2);
}
const childN = await scalar(
  `SELECT count(*)::int AS n FROM public.payment_reconciliation_log ` +
  `WHERE raw_transaction_id IN (SELECT id FROM public.redpay_raw_transactions WHERE ${PARENT_WHERE});`,
);
const childPay = await scalar(
  `SELECT count(*)::int AS n FROM public.payment_reconciliation_log ` +
  `WHERE raw_transaction_id IN (SELECT id FROM public.redpay_raw_transactions WHERE ${PARENT_WHERE}) ` +
  `AND payment_id IS NOT NULL;`,
);
const childImpure = await scalar(
  `SELECT count(*)::int AS n FROM public.payment_reconciliation_log ` +
  `WHERE raw_transaction_id IN (SELECT id FROM public.redpay_raw_transactions WHERE ${PARENT_WHERE}) ` +
  `AND external_trxid IS DISTINCT FROM '0723C8124555';`,
);
console.log(`── [gate] child(recon_log) 실측 = ${childN} (판정시점 816; moving-target — 실측 그대로 freeze)`);
console.log(`── [gate] child 원장접점 payment_id NOT NULL = ${childPay} (기대=0) · 타 trxid 혼입 = ${childImpure} (기대=0)`);
if (childPay !== 0) {
  console.error(`\n⛔ ABORT — child payment_id NOT NULL=${childPay} > 0. 원장 접점 → change-class 상향, 재-CONSULT/CEO게이트.`);
  process.exit(2);
}
if (childImpure !== 0) {
  console.error(`\n⛔ ABORT — child 타 external_trxid=${childImpure} > 0. scope 오염 → 재-freeze·supervisor 보고.`);
  process.exit(2);
}
console.log('  ✅ SAFE — parent=2, 명시id=2, child 순수(payment_id NULL 전량, trxid 단일). 진행.\n');

if (!APPLY) {
  console.log('── [DRY] 계획 ──');
  console.log(`  [1단] archive-first: ${ARCH_RAW}(2) + ${ARCH_CHILD}(${childN}) 스냅샷`);
  console.log(`  [2단] ${FILE} 적용 (child-first DELETE: recon_log ${childN} → raw 2, archive==delete 가드)`);
  console.log('  [post] parent 잔여 0 확인 + residual child 계측 + ledger');
  console.log('\n실적용: --apply 플래그. (supervisor DB-GATE)\n');
  process.exit(0);
}

// ── [1단] archive-first: 파괴 前 _backup 스냅샷 (child-first 삭제 대상 전량) ──
console.log('── [1단] archive-first _backup 스냅샷 ──');
await query(`CREATE SCHEMA IF NOT EXISTS _backup;`);
// parent 2행
await query(
  `CREATE TABLE IF NOT EXISTS ${ARCH_RAW} AS ` +
  `SELECT * FROM public.redpay_raw_transactions WHERE ${PARENT_WHERE};`,
);
// child N행 (parent 지문에 매달린 recon_log 전량 — 이 순간 동결)
await query(
  `CREATE TABLE IF NOT EXISTS ${ARCH_CHILD} AS ` +
  `SELECT * FROM public.payment_reconciliation_log ` +
  `WHERE raw_transaction_id IN (SELECT id FROM public.redpay_raw_transactions WHERE ${PARENT_WHERE});`,
);
const snapRaw = await scalar(`SELECT count(*)::int AS n FROM ${ARCH_RAW};`);
const snapChild = await scalar(`SELECT count(*)::int AS n FROM ${ARCH_CHILD};`);
console.log(`  raw archive = ${snapRaw} (기대=2) · child archive = ${snapChild} (동결 freeze-set)`);
if (snapRaw !== 2 || snapChild < 1) {
  console.error(`\n⛔ ABORT — archive 부실(raw=${snapRaw}, child=${snapChild}). 롤백 원복 불가 위험 → 파괴 금지.`);
  process.exit(2);
}
console.log('  ✅ archive 확보 (순소실0 기준셋 동결).\n');

// ── [2단] up.sql 적용 (본체 archive==delete·child-first·순소실0 가드 재실행) ──
console.log('── [2단] up.sql 적용 (child-first hard-DELETE) ──');
await applyMigration({ version: VERSION, file: FILE, dryRun: false, createdBy: 'dev-foot-DOSU-CONTAM-FIX' });

// ── [post] parent 잔여 0 + residual child 계측 ──
const residPar = await scalar(`SELECT count(*)::int AS n FROM public.redpay_raw_transactions WHERE ${PARENT_WHERE};`);
console.log(`\n── [post] parent 잔여 = ${residPar} (기대=0)`);
if (residPar !== 0) {
  console.error(`⚠ parent 잔여 ${residPar} 행 — 삭제 미완. supervisor 확인.`);
  process.exit(2);
}
// residual child: parent 가 사라졌으므로 raw_transaction_id join 불가 → external_trxid 로 잔재 계측
const residChild = await scalar(
  `SELECT count(*)::int AS n FROM public.payment_reconciliation_log ` +
  `WHERE external_trxid = '0723C8124555' AND center = 'body';`,
);
console.log(`── [post] residual child(archive後 신규 적재 도수 telemetry) = ${residChild}`);
console.log('   → 파트A merchant-drop EF 배포 + parent 제거로 소스 차단됨 → residual 자연 수렴. 잔재는 후속 sweep 대상.');
await recordLedger({ version: VERSION, name: FILE, createdBy: 'dev-foot-DOSU-CONTAM-FIX', dryRun: false });
console.log(`  ✅ child-first hard-DELETE 완료 · parent 잔여 0 · child archive=${snapChild} 삭제 · ledger 기록.`);
console.log('  → 파트B 정정 후 풋 457 net 재집계(도수쌍 ±1,004 제거) → 현장 진실값(승인24+취소1/net 10,779,980) 정합.');
