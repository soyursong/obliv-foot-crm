/**
 * T-20260805-foot-REPAY-METHODCHG-UNMATCH-REFUND-F4717 — Phase A READ-ONLY 진단
 *
 * ⛔ READ-ONLY. prod WRITE/DELETE 0. 전부 SELECT.
 * 현은호(F-4717) 결제수단변경 재결제 → 매칭누락 → 패키지 '환불' 오표시 진단.
 *
 * ★핵심 축 발견: 결제 원장이 2개다.
 *   ① package_payments — refund_package_payment RPC 의 net_paid 산출 대상(status 파생 구동).
 *   ② payments(package_id 有) — VAN 대사 대상. external_trxid/reconciled_at/external_status 보유.
 *   두 원장 사이 재결제가 어디에 착지했는지가 '매칭 안 됨'의 실체 축.
 *
 *   AC-1 F-4717 두 원장 전 이벤트
 *   AC-2 원결제→환불→재결제 재구성 + 패키지 '환불' 판정근거(packages.status / paid_amount)
 *   AC-3 매칭 실패 RC (net_paid 파생 + reverse-transition 부재 + 원장 분열)
 *   AC-4 재발 census
 *
 * 실행: node scripts/T-20260805-foot-REPAY-METHODCHG-UNMATCH-REFUND-F4717_diag.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ENV = join(here, '..', '.env.local');
const env = Object.fromEntries(
  readFileSync(ENV, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const TOK = (process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN || '').trim();
const REF = 'rxlomoozakkjesdqjtvd';

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const j = (x) => JSON.stringify(x, null, 2);

console.log('════════ F-4717 결제수단변경 재결제 매칭누락 진단 (READ-ONLY) ════════\n');

// ── 0. 대상 고객 ──
const cust = await q(`
  SELECT id, name, phone, chart_number, clinic_id, created_at
  FROM customers WHERE chart_number ILIKE '%4717%' ORDER BY chart_number LIMIT 20`);
console.log('── 0. 고객 식별 ──'); console.log(j(cust));
if (!cust.length) { console.log('⚠ 미발견'); process.exit(0); }
const target = cust.find((c) => /(^|\D)4717(\D|$)/.test(String(c.chart_number))) || cust[0];
const CID = target.id;
console.log(`\n★ customer_id=${CID} (${target.name} / ${target.chart_number})\n`);

// ── AC-1a. 패키지 목록 ──
const pkgs = await q(`
  SELECT id, package_name, package_type, status, total_amount, paid_amount,
         total_sessions, superseded_by, transferred_from, transferred_to,
         contract_date, created_by, created_at, updated_at
  FROM packages WHERE customer_id = '${CID}' ORDER BY created_at`);
console.log('── AC-1a. packages ──'); console.log(j(pkgs));
const pkgIds = pkgs.map((p) => `'${p.id}'`).join(',') || `'00000000-0000-0000-0000-000000000000'`;

// ── AC-1b. package_payments 원장 (net_paid 구동 원장 ①) ──
const pp = await q(`
  SELECT id, package_id, amount, method, payment_type, parent_payment_id, fee_kind,
         installment, external_approval_no, external_tid, accounting_date, origin_tx_date,
         is_simulation, memo, created_by, created_at
  FROM package_payments WHERE customer_id = '${CID}' ORDER BY created_at`);
console.log('\n── AC-1b. package_payments 원장 ① (RPC net_paid 구동) ──'); console.log(j(pp));

// ── AC-1c. payments 원장 (VAN 대사 원장 ②, package_id 링크) ──
const pay = await q(`
  SELECT id, package_id, check_in_id, amount, method, payment_type, status,
         parent_payment_id, linked_payment_id, external_trxid, external_approval_no,
         external_tid, external_status, reconciled_at, accounting_date, is_simulation,
         cancelled_at, deleted_at, created_by, created_at
  FROM payments WHERE customer_id = '${CID}' ORDER BY created_at`);
console.log('\n── AC-1c. payments 원장 ② (VAN 대사·package_id 링크) ──'); console.log(j(pay));

// payments 중 이 고객 패키지에 링크된 것 강조
const payLinkedPkg = pay.filter((p) => pkgs.some((k) => k.id === p.package_id));
console.log(`\n  ▸ payments 중 이 고객 package_id 링크: ${payLinkedPkg.length}건 / 전체 ${pay.length}건`);

// ── AC-2. 패키지별 net_paid 재구성 (원장 ①만 / 원장 ②만 / 합산) + status 정합 ──
console.log('\n── AC-2. 패키지별 net_paid 재구성 (원장별 분리) + status 판정근거 ──');
const netByPkg = await q(`
  SELECT p.id AS package_id, p.package_name, p.status, p.paid_amount, p.total_amount,
    -- 원장① package_payments net (RPC 가 보는 값)
    COALESCE((SELECT SUM(CASE WHEN pp.payment_type='payment' THEN pp.amount
                              WHEN pp.payment_type='refund'  THEN -pp.amount ELSE 0 END)
              FROM package_payments pp WHERE pp.package_id=p.id),0) AS net_pp,
    -- 원장② payments net (같은 package_id, active 상태만)
    COALESCE((SELECT SUM(CASE WHEN py.payment_type='payment' THEN py.amount
                              WHEN py.payment_type='refund'  THEN -py.amount ELSE 0 END)
              FROM payments py WHERE py.package_id=p.id
                AND py.deleted_at IS NULL AND COALESCE(py.status,'active')<>'cancelled'),0) AS net_pay
  FROM packages p WHERE p.customer_id='${CID}' ORDER BY p.created_at`);
console.log(j(netByPkg));
console.log('\n  ▸ 판정근거: packages.status 컬럼 직접구동(뷰 없음 — information_schema.views 확인결과 0).');
console.log('  ▸ refund_package_payment RPC: net_pp<=0 & status=active → refunded (원장①만 봄).');
console.log('  ▸ status=refunded 인데 (net_pp>0 또는 net_pay>0) = 재결제 net 복원됐으나 status 고착 = 오표시.');
console.log('  ▸ 재결제가 원장②(payments)에만 있고 원장①(package_payments)엔 없으면 = RPC net_pp 미복원(원장분열 RC).');

// ── AC-2b. refund 링크 체인 (parent_payment_id) ──
console.log('\n── AC-2b. package_payments parent 링크 체인 ──');
const chain = await q(`
  SELECT pp.id, pp.payment_type, pp.amount, pp.method, pp.parent_payment_id,
         par.payment_type AS parent_type, par.amount AS parent_amount, pp.created_at
  FROM package_payments pp LEFT JOIN package_payments par ON par.id=pp.parent_payment_id
  WHERE pp.customer_id='${CID}' ORDER BY pp.created_at`);
console.log(j(chain));

// ── AC-3. RC 데이터 정합 (reverse transition 부재 = 코드리포트, 여기선 status write 흔적) ──
console.log('\n── AC-3. RC: packages.updated_at vs 최종 재결제 시각 (status 미복원 확증) ──');
const rc = await q(`
  SELECT p.id, p.status, p.updated_at,
    (SELECT max(created_at) FROM package_payments pp WHERE pp.package_id=p.id AND pp.payment_type='payment') AS last_pp_payment,
    (SELECT max(created_at) FROM package_payments pp WHERE pp.package_id=p.id AND pp.payment_type='refund')  AS last_pp_refund,
    (SELECT max(created_at) FROM payments py WHERE py.package_id=p.id AND py.payment_type='payment') AS last_pay_payment
  FROM packages p WHERE p.customer_id='${CID}' ORDER BY p.created_at`);
console.log(j(rc));

// ── AC-4. 재발 census: status=refunded & net_pp>0 (원장① 기준, 재결제 후 미복원) ──
console.log('\n── AC-4a. 재발 census: status=refunded 인데 package_payments net>0 (전 클리닉) ──');
const censusPP = await q(`
  WITH net AS (
    SELECT p.id, p.customer_id, p.status,
           COALESCE(SUM(CASE WHEN pp.payment_type='payment' THEN pp.amount
                             WHEN pp.payment_type='refund'  THEN -pp.amount ELSE 0 END),0) AS net_pp
    FROM packages p LEFT JOIN package_payments pp ON pp.package_id=p.id
    WHERE COALESCE(p.status,'') NOT IN ('transferred')
    GROUP BY p.id
  )
  SELECT count(*) AS affected_pkgs, count(DISTINCT customer_id) AS affected_customers,
         COALESCE(SUM(net_pp),0) AS total_stranded_net
  FROM net WHERE status='refunded' AND net_pp>0`);
console.log('  [원장① 기준 규모]', j(censusPP));

console.log('\n── AC-4b. 재발 census: status=refunded 인데 payments(원장②) net>0 ──');
const censusPay = await q(`
  WITH net AS (
    SELECT p.id, p.customer_id, p.status,
           COALESCE(SUM(CASE WHEN py.payment_type='payment' THEN py.amount
                             WHEN py.payment_type='refund'  THEN -py.amount ELSE 0 END),0) AS net_pay
    FROM packages p LEFT JOIN payments py ON py.package_id=p.id
      AND py.deleted_at IS NULL AND COALESCE(py.status,'active')<>'cancelled'
    WHERE COALESCE(p.status,'') NOT IN ('transferred')
    GROUP BY p.id
  )
  SELECT count(*) AS affected_pkgs, count(DISTINCT customer_id) AS affected_customers,
         COALESCE(SUM(net_pay),0) AS total_stranded_net
  FROM net WHERE status='refunded' AND net_pay>0`);
console.log('  [원장② 기준 규모]', j(censusPay));

console.log('\n── AC-4c. 재발 상세 (원장① net_pp>0 & refunded, 최대 50) ──');
const censusRows = await q(`
  WITH net AS (
    SELECT p.id, p.package_name, p.customer_id, p.status, p.created_at, p.updated_at,
           COALESCE(SUM(CASE WHEN pp.payment_type='payment' THEN pp.amount
                             WHEN pp.payment_type='refund'  THEN -pp.amount ELSE 0 END),0) AS net_pp
    FROM packages p LEFT JOIN package_payments pp ON pp.package_id=p.id GROUP BY p.id
  )
  SELECT n.id AS package_id, n.package_name, n.status, n.net_pp, c.chart_number, c.name AS cust_name, n.created_at
  FROM net n JOIN customers c ON c.id=n.customer_id
  WHERE n.status='refunded' AND n.net_pp>0 ORDER BY n.net_pp DESC LIMIT 50`);
console.log(j(censusRows));

// ── AC-4d. 결제수단변경 패턴 census: 같은 패키지 환불 직후 재payment ──
console.log('\n── AC-4d. 결제수단변경 패턴(환불→후속 payment) 발생 패키지 수 ──');
const methodChg = await q(`
  WITH ev AS (
    SELECT package_id, payment_type, created_at,
           lag(payment_type) OVER (PARTITION BY package_id ORDER BY created_at) AS prev_type
    FROM package_payments
  )
  SELECT count(DISTINCT package_id) AS pkgs_refund_then_repay
  FROM ev WHERE payment_type='payment' AND prev_type='refund'`);
console.log(j(methodChg));

console.log('\n════════ 진단 완료 (READ-ONLY, mutation 0) ════════');
