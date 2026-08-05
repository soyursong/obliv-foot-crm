/**
 * T-20260805-foot-REPAY-METHODCHG-UNMATCH-REFUND-F4717 — Phase B FREEZE + SNAPSHOT (READ-ONLY, write 0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Cross-CRM Data-Correction Backfill SOP 봉투 — F-4717 현은호 패키지 '환불' 오표시 소급정정.
 *
 * DA CONSULT-REPLY GO: DA-20260805-foot-REPAY-PKGLINK-REVTRANSITION-FWDFIX (status=done).
 *   Phase B = "1행 링크+status refunded→active(양방향 파생 배포 후 링크만으로 auto-heal 가능·C4 결정)".
 *   Phase C(FWDFIX) deployed 2026-08-05 17:11 (mig 20260805171000/171100/171200, main 1036230c) →
 *   trg_payments_pkg_status_recompute 실재(prod introspection PASS) → payments.package_id populate 시 status auto-heal.
 *
 * 정정 기전(최소침습·single-authority):
 *   UPDATE payments SET package_id = <PKG> WHERE id = <REPAY> AND package_id IS NULL   (정확히 1행)
 *   → AFTER UPDATE 트리거 발화 → foot_recompute_package_status(PKG):
 *        net = 원장①(package_payments, 0) + 원장②(payments status='active' linked, +5,760,000) = 5,760,000 > 0
 *        → packages.status refunded→active (auto-heal). ⛔ packages 직접 write 안 함(status authority=트리거).
 *   ⛔ 원장① 미러 payment auto-create 금지(DORMANTGAP guard 양립·이중계상 0). package_payments 무접점.
 *
 * 이 스크립트는 절대 write 하지 않는다. freeze 재도출 + assert + archive-first before-image 출력.
 * 인증컨텍스트: Management API /database/query (service_role 등가·DB 전건 가시).
 */
import { query } from './lib/foot_migration_ledger.mjs';
import { writeFileSync } from 'node:fs';

const PKG_ID = '9455ca84-5798-413b-bd45-7457616d7f55';       // F-4717 24회권 5,760,000
const CUSTOMER_ID = '6412fbf7-8a53-4d49-af7a-491e1d731b4c';  // 현은호
const REPAY_PK = '8bf6ac26-dd20-4cfc-af38-7113868c9882';     // 재결제 payment (원장②)
const REPAY_AMOUNT = 5760000;

const j = (o) => JSON.stringify(o, null, 2);
let abort = false;
const A = (cond, msg) => { if (!cond) { abort = true; console.log(`⛔ ABORT — ${msg}`); } };

console.log('=== T-20260805 F-4717 Phase B FREEZE + SNAPSHOT (READ-ONLY) ===\n');

// ── 1. 대상 package (freeze 앵커) — before-image ──
const pkg = (await query(
  `SELECT id, customer_id, clinic_id, status, total_amount, paid_amount, total_sessions,
          transferred_to, transferred_from, superseded_by, updated_at
   FROM packages WHERE id = '${PKG_ID}';`))[0] || {};
console.log('── package (원장① 파생 status 대상, freeze PK) ──'); console.log(j(pkg));
A(!!pkg.id, 'package 부재');
A(pkg.customer_id === CUSTOMER_ID, 'package.customer_id != 현은호');
A(pkg.status === 'refunded', `package.status != 'refunded' (현재 '${pkg.status}') — 이미 정정/drift → apply 재평가`);
A(!pkg.transferred_to && !pkg.superseded_by, '양도/승계 상태 존재 — active 복원 정합성 재확인 필요(별상태)');

// ── 2. 재결제 payment (원장②, 링크 채울 freeze 1행) — before-image ──
const repay = (await query(
  `SELECT id, customer_id, package_id, payment_type, amount, method, external_trxid,
          reconciled_at, status, deleted_at, is_simulation, created_at
   FROM payments WHERE id = '${REPAY_PK}';`))[0] || {};
console.log('\n── 재결제 payment (freeze PK, package_id populate 대상) ──'); console.log(j(repay));
A(!!repay.id, '재결제 payment 부재');
A(repay.customer_id === CUSTOMER_ID, '재결제.customer_id != 현은호');
A(repay.package_id === null, `재결제.package_id 이미 non-NULL ('${repay.package_id}') — 이미 링크됨/drift → apply 금지`);
A(Number(repay.amount) === REPAY_AMOUNT, `재결제 amount != ${REPAY_AMOUNT}`);
A(repay.payment_type === 'payment', `재결제 payment_type != 'payment'`);
A(repay.method === 'card', `재결제 method != 'card'`);
A(repay.status === 'active' && repay.deleted_at === null, '재결제 status!=active 또는 soft-deleted — net 산입 불가');
A(!!repay.reconciled_at, '재결제 reconciled_at 부재 — VAN 대사 미완(판정근거 미충족)');
A(repay.is_simulation === false, '재결제 is_simulation=true — 테스트행');

// ── 3. under-correct≫over 가드: 지문 매칭 재결제가 정확히 1행인지 ──
const dup = await query(
  `SELECT id FROM payments
   WHERE customer_id='${CUSTOMER_ID}' AND package_id IS NULL AND payment_type='payment'
     AND amount=${REPAY_AMOUNT} AND status='active' AND deleted_at IS NULL;`);
A(dup.length === 1 && dup[0].id === REPAY_PK, `지문 매칭 재결제 != 정확히 freeze PK 1행 (got ${dup.length}: ${dup.map(x=>x.id).join(',')})`);

// ── 4. 원장① package_payments 대조 (무접점·net=0 판정근거) ──
const pp = await query(
  `SELECT id, payment_type, amount, method, parent_payment_id, created_at
   FROM package_payments WHERE package_id = '${PKG_ID}' ORDER BY created_at;`);
const ppNet = pp.reduce((s, x) => s + (x.payment_type === 'refund' ? -Number(x.amount) : Number(x.amount)), 0);
console.log('\n── 원장① package_payments (무접점·환불행 존치) ──'); console.log(j(pp));
console.log(`원장① net_pp = ${ppNet}  (기대 0 = 전액환불)`);
A(ppNet === 0, `원장① net != 0 (got ${ppNet})`);

// ── 5. cross-ledger 판정근거 (정정 前/後 예상) ──
const payNetBefore = Number((await query(
  `SELECT COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) AS net
   FROM payments WHERE package_id='${PKG_ID}' AND status='active' AND deleted_at IS NULL;`))[0]?.net);
console.log('\n── 판정근거 (cross-ledger) ──');
console.log(`정정 前 원장② net WHERE package_id=PKG : ${payNetBefore}  (0 예상 — 링크 前)`);
console.log(`정정 後 예상 cross-ledger net = ${ppNet} + ${REPAY_AMOUNT} = ${ppNet + REPAY_AMOUNT} > 0 → status active auto-heal`);

// ── 6. 매출 firewall 판정근거 (정정 前 스냅샷, 정정 後 불변 검증용) ──
const rev = (await query(
  `SELECT COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) AS net_pay
   FROM payments WHERE customer_id='${CUSTOMER_ID}' AND status='active' AND deleted_at IS NULL;`))[0];
console.log(`매출 firewall: customer payments net(package_id 무관·정정으로 불변 기대) = ${rev.net_pay}`);

// ── FREEZE-SET + before-image 산출 ──
const evidence = {
  ticket: 'T-20260805-foot-REPAY-METHODCHG-UNMATCH-REFUND-F4717',
  phase: 'B',
  da_consult_ref: 'DA-20260805-foot-REPAY-PKGLINK-REVTRANSITION-FWDFIX',
  captured_note: 'READ-ONLY freeze+before-image (no persistence)',
  freeze_pks: { package_id: PKG_ID, repay_payment_id: REPAY_PK },
  before_image: { packages_row: pkg, repay_payment_row: repay, package_payments_ledger1: pp },
  judgment_basis: {
    ledger1_net_pp: ppNet,
    ledger2_repay_amount: REPAY_AMOUNT,
    ledger2_reconciled_at: repay.reconciled_at,
    crossledger_net_before: ppNet + payNetBefore,
    crossledger_net_after_expected: ppNet + REPAY_AMOUNT,
    expected_status_transition: `${pkg.status} -> active`,
    revenue_firewall_customer_net_pay: rev.net_pay,
  },
  planned_mutation: {
    sql: `UPDATE payments SET package_id = '${PKG_ID}' WHERE id = '${REPAY_PK}' AND package_id IS NULL;`,
    expect_rows_affected: 1,
    status_authority: 'trigger trg_payments_pkg_status_recompute (packages 직접 write 금지)',
  },
  rollback: {
    sql: `UPDATE payments SET package_id = NULL WHERE id = '${REPAY_PK}';  -- 트리거가 status refunded 재파생(대칭)`,
    note: '원장① package_payments 무접점(환불행 존치). packages.status 는 트리거 auto-revert.',
  },
};
writeFileSync(
  new URL('./T-20260805-foot-REPAY-METHODCHG-UNMATCH-REFUND-F4717_backfill_evidence.json', import.meta.url),
  j(evidence));
console.log('\n============ FREEZE-SET (명시 PK) ============'); console.log(j(evidence.freeze_pks));
console.log('evidence → scripts/T-20260805-foot-REPAY-METHODCHG-UNMATCH-REFUND-F4717_backfill_evidence.json');
console.log(`\n=== RESULT: ${abort ? '⛔ ABORT (freeze 불안전 — apply 금지)' : '✅ FREEZE OK (supervisor dry-run 게이트로)'} ===`);
process.exit(abort ? 1 : 0);
