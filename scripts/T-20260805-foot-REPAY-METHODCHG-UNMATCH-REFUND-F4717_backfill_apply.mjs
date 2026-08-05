/**
 * T-20260805-foot-REPAY-METHODCHG-UNMATCH-REFUND-F4717 — Phase B APPLY (WRITE, hard-gated)
 * ─────────────────────────────────────────────────────────────────────────────
 * Cross-CRM Data-Correction Backfill SOP 봉투 — F-4717 1행 소급정정.
 * ⛔ 실행 조건: (1) DA CONSULT-REPLY GO(DA-20260805-...REVTRANSITION-FWDFIX·done)
 *              (2) supervisor dry-run 게이트 PASS  (3) `--apply` 플래그.
 * --apply 없으면 재-freeze 검증만 하고 write 0(중립 종료).
 *
 * 기전: UPDATE payments SET package_id=<PKG> WHERE id=<REPAY> AND package_id IS NULL RETURNING id (1행)
 *       → 트리거 자동 recompute → packages.status refunded→active.
 * 안전: apply-직전 re-freeze ABORT · rows==1 assert · post-verify(status/link/매출불변/원장① 무접점).
 */
import { query } from './lib/foot_migration_ledger.mjs';
import { writeFileSync } from 'node:fs';

const PKG_ID = '9455ca84-5798-413b-bd45-7457616d7f55';
const CUSTOMER_ID = '6412fbf7-8a53-4d49-af7a-491e1d731b4c';
const REPAY_PK = '8bf6ac26-dd20-4cfc-af38-7113868c9882';
const REPAY_AMOUNT = 5760000;
const APPLY = process.argv.includes('--apply');

const j = (o) => JSON.stringify(o, null, 2);
const die = (msg) => { console.log(`\n⛔ ABORT — ${msg}`); process.exit(1); };

console.log(`=== T-20260805 F-4717 Phase B APPLY (${APPLY ? 'WRITE' : 'DRY re-freeze only'}) ===\n`);

// ── apply-직전 re-freeze ABORT (before-image 대조) ──
const pkg0 = (await query(`SELECT id,customer_id,status,transferred_to,superseded_by FROM packages WHERE id='${PKG_ID}';`))[0];
if (!pkg0) die('package 부재');
if (pkg0.customer_id !== CUSTOMER_ID) die('package customer drift');
if (pkg0.status !== 'refunded') die(`package.status drift ('${pkg0.status}' != refunded) — 이미 정정/변경됨`);
if (pkg0.transferred_to || pkg0.superseded_by) die('양도/승계 drift');

const r0 = (await query(
  `SELECT id,package_id,payment_type,amount,method,status,deleted_at,reconciled_at,is_simulation
   FROM payments WHERE id='${REPAY_PK}';`))[0];
if (!r0) die('재결제 payment 부재');
if (r0.package_id !== null) die(`repay.package_id drift ('${r0.package_id}' != NULL) — 이미 링크됨`);
if (Number(r0.amount) !== REPAY_AMOUNT) die('repay amount drift');
if (r0.payment_type !== 'payment' || r0.method !== 'card') die('repay type/method drift');
if (r0.status !== 'active' || r0.deleted_at !== null) die('repay status/deleted drift');
if (!r0.reconciled_at) die('repay reconciled drift');
if (r0.is_simulation !== false) die('repay is_simulation drift');

const ppNet0 = Number((await query(
  `SELECT COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) net,
          COUNT(*) c FROM package_payments WHERE package_id='${PKG_ID}';`))[0].net);
const revBefore = Number((await query(
  `SELECT COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) net
   FROM payments WHERE customer_id='${CUSTOMER_ID}' AND status='active' AND deleted_at IS NULL;`))[0].net);
console.log(`re-freeze PASS · 원장① net=${ppNet0} · 매출 net(before)=${revBefore}`);

if (!APPLY) {
  console.log('\n(--apply 미지정) write 0 — supervisor dry-run PASS + GO 후 --apply 로 실행.');
  process.exit(0);
}

// ── APPLY: 단일행 UPDATE + rows==1 assert ──
const updated = await query(
  `UPDATE payments SET package_id = '${PKG_ID}'
   WHERE id = '${REPAY_PK}' AND package_id IS NULL
   RETURNING id, package_id;`);
if (updated.length !== 1) die(`rows-affected != 1 (got ${updated.length}) — 롤백 필요`);
console.log(`\n✅ UPDATE OK — payments ${updated[0].id} package_id=${updated[0].package_id} (1행)`);

// ── post-verify (트리거 auto-heal 결과) ──
const pkg1 = (await query(`SELECT status FROM packages WHERE id='${PKG_ID}';`))[0];
const r1 = (await query(`SELECT package_id FROM payments WHERE id='${REPAY_PK}';`))[0];
const ppNet1 = Number((await query(
  `SELECT COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) net,
          COUNT(*) c FROM package_payments WHERE package_id='${PKG_ID}';`))[0].net);
const revAfter = Number((await query(
  `SELECT COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) net
   FROM payments WHERE customer_id='${CUSTOMER_ID}' AND status='active' AND deleted_at IS NULL;`))[0].net);

const checks = [
  ['VG: packages.status → active (auto-heal)', pkg1.status === 'active'],
  ['VG: repay.package_id linked', r1.package_id === PKG_ID],
  ['VG: 원장① package_payments 무접점(net 불변)', ppNet1 === ppNet0],
  ['VG: 매출 firewall 불변(customer net)', revAfter === revBefore],
];
console.log('\n── post-verify ──');
let ok = true; for (const [m, c] of checks) { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) ok = false; }
console.log(`  packages.status = '${pkg1.status}' · repay.package_id = ${r1.package_id} · 매출 ${revBefore}→${revAfter}`);

writeFileSync(new URL('./T-20260805-foot-REPAY-METHODCHG-UNMATCH-REFUND-F4717_backfill_afterimage.json', import.meta.url),
  j({ applied: true, rows_affected: 1, package_status_after: pkg1.status, repay_package_id_after: r1.package_id,
      ledger1_net_after: ppNet1, revenue_net_before: revBefore, revenue_net_after: revAfter,
      rollback_sql: `UPDATE payments SET package_id = NULL WHERE id = '${REPAY_PK}';` }));

if (!ok) die('post-verify FAIL — rollback 검토 (UPDATE payments SET package_id=NULL WHERE id=REPAY_PK)');
console.log('\n=== APPLY COMPLETE ✅ — F-4717 패키지 active 복원, 매출 불변, 원장① 무접점 ===');
