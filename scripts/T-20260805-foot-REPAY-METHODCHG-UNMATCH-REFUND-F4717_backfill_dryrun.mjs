/**
 * T-20260805-foot-REPAY-METHODCHG-UNMATCH-REFUND-F4717 — Phase B DRY-RUN (write 0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Cross-CRM Data-Correction Backfill SOP 봉투 — supervisor dry-run 게이트용.
 * freeze 재도출 + assert + 트리거 recompute 시뮬레이션(예상 status) + rollback SQL. 절대 write 0.
 *
 * 실행: node scripts/T-20260805-...F4717_backfill_dryrun.mjs
 * 기전: UPDATE payments SET package_id=<PKG> WHERE id=<REPAY> AND package_id IS NULL (1행)
 *       → trg_payments_pkg_status_recompute → foot_recompute_package_status(PKG)
 *       → cross-ledger net=0+5,760,000>0 → packages.status refunded→active (auto-heal).
 */
import { query } from './lib/foot_migration_ledger.mjs';

const PKG_ID = '9455ca84-5798-413b-bd45-7457616d7f55';
const CUSTOMER_ID = '6412fbf7-8a53-4d49-af7a-491e1d731b4c';
const REPAY_PK = '8bf6ac26-dd20-4cfc-af38-7113868c9882';
const REPAY_AMOUNT = 5760000;

let abort = false;
const A = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) abort = true; };

console.log('=== T-20260805 F-4717 Phase B DRY-RUN (write 0) ===\n');

// freeze 재도출 + assert
const pkg = (await query(`SELECT id,customer_id,status,transferred_to,superseded_by FROM packages WHERE id='${PKG_ID}';`))[0] || {};
A(pkg.customer_id === CUSTOMER_ID, 'package = 현은호 F-4717');
A(pkg.status === 'refunded', `package.status='refunded' (현재 '${pkg.status}')`);
A(!pkg.transferred_to && !pkg.superseded_by, '양도/승계 없음 → active 복원 정합');

const repay = (await query(
  `SELECT id,customer_id,package_id,payment_type,amount,method,status,deleted_at,reconciled_at,is_simulation
   FROM payments WHERE id='${REPAY_PK}';`))[0] || {};
A(repay.package_id === null, 'repay.package_id = NULL (링크 前)');
A(Number(repay.amount) === REPAY_AMOUNT, `repay.amount = ${REPAY_AMOUNT}`);
A(repay.payment_type === 'payment' && repay.method === 'card', 'repay = card payment');
A(repay.status === 'active' && repay.deleted_at === null, 'repay active·non-deleted (net 산입)');
A(!!repay.reconciled_at, 'repay VAN reconciled (판정근거)');
A(repay.is_simulation === false, 'repay 실거래(비시뮬)');

// under-correct≫over: 지문 매칭 정확히 1행
const dup = await query(
  `SELECT id FROM payments WHERE customer_id='${CUSTOMER_ID}' AND package_id IS NULL
     AND payment_type='payment' AND amount=${REPAY_AMOUNT} AND status='active' AND deleted_at IS NULL;`);
A(dup.length === 1 && dup[0].id === REPAY_PK, `지문 매칭 = freeze PK 1행 (got ${dup.length})`);

// 트리거 recompute 시뮬레이션 (실 함수 로직 그대로)
const ppNet = Number((await query(
  `SELECT COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) net
   FROM package_payments WHERE package_id='${PKG_ID}';`))[0].net);
const payNetAfter = ppNet + REPAY_AMOUNT; // 링크 후 원장② 5.76M 산입
const targetStatus = payNetAfter > 0 ? 'active' : 'refunded';
console.log('\n── 트리거 recompute 시뮬 ──');
console.log(`  원장① net_pp = ${ppNet}`);
console.log(`  원장② repay(링크 후·active) = +${REPAY_AMOUNT}`);
console.log(`  cross-ledger net = ${payNetAfter} → target status = '${targetStatus}'`);
A(targetStatus === 'active', 'recompute → active (auto-heal)');

// 매출 firewall 예상 불변
const revBefore = Number((await query(
  `SELECT COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) net
   FROM payments WHERE customer_id='${CUSTOMER_ID}' AND status='active' AND deleted_at IS NULL;`))[0].net);
console.log(`\n매출 firewall: customer payments net = ${revBefore} (정정 後 불변 기대 — package_id 링크는 매출뷰 무영향·C5)`);

console.log('\n── 계획된 mutation (1행) ──');
console.log(`  UPDATE payments SET package_id = '${PKG_ID}' WHERE id = '${REPAY_PK}' AND package_id IS NULL;`);
console.log(`  expect rows-affected = 1 · packages.status 는 트리거가 active 파생(직접 write 없음)`);
console.log('── rollback (대칭·원장① 무접점) ──');
console.log(`  UPDATE payments SET package_id = NULL WHERE id = '${REPAY_PK}';  -- 트리거가 refunded 재파생`);

console.log(`\n=== DRY-RUN RESULT: ${abort ? '⛔ ABORT' : '✅ PASS (supervisor GO → _apply.mjs --apply)'} ===`);
process.exit(abort ? 1 : 0);
