/**
 * T-20260717-foot-F4857-REFUND-MISENTRY-MISU-FIX — R1 다운스트림 검증 (READ-ONLY, zero-write).
 *
 * DA GAP-REPORT(MSG-20260717-215952-xibf) 파생 확인:
 *   (a) phantom pkg 38cfc0d4 가 systemic L2 TIGHT 40-pkg 집합에 포함되는가?  (diag SNAPSHOT 대조)
 *   (b) 엘런(F-4857) 회수1 패키지 paid_amount = 500,000 인가?               (live prod SELECT)
 *   YES/YES → R1(effectiveNetPaid 중앙화, deployed df296dcf 21:51) 폴백으로
 *             prod outstanding=0 자동 산출되는지 실증 (loadCustomerOutstanding 로직 재현).
 *
 * ★ READ-ONLY: SELECT only. 어떤 write/DDL 도 하지 않는다. apply·archive 절대 금지.
 * ★ 재현 대상 = src/lib/footBilling.ts (deployed R1) 의 loadCustomerOutstanding 산식 그대로.
 */
import { readFileSync, writeFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

// ── footBilling.ts (deployed R1) 산식 1:1 재현 ──────────────────────────────
const isSinglePaymentByCount = (ts) => (ts ?? 0) <= 1;
const netPaidFromPayments = (payments, feeKind) => {
  if (!payments) return 0;
  return payments.reduce((sum, p) => {
    if (feeKind && (p.fee_kind ?? 'package') !== feeKind) return sum;
    const signed = p.payment_type === 'refund' ? -(p.amount ?? 0) : (p.amount ?? 0);
    return sum + signed;
  }, 0);
};
const effectiveNetPaid = (pkg, rows) => {
  const rowsEmpty = (rows?.length ?? 0) === 0;
  if (rowsEmpty && (isSinglePaymentByCount(pkg.total_sessions) || pkg.transferred_from)) {
    return pkg.paid_amount ?? 0;
  }
  return netPaidFromPayments(rows, 'package');
};
const computeOutstanding = (total, net) => Math.round((total ?? 0) - (net ?? 0));

const out = { ts_utc: new Date().toISOString(), read_only: true };

// 1) F-4857 고객 식별
const custRows = await q(`
  SELECT id, name, chart_number, clinic_id
  FROM public.customers WHERE chart_number ILIKE '%4857%' ORDER BY created_at DESC;`);
const cust = custRows[0];
if (!cust) { console.error('!! F-4857 미발견'); process.exit(2); }
out.customer = cust;
const cid = cust.id, clinicId = cust.clinic_id;

// 2) loadCustomerOutstanding 이 보는 것과 동일: status='active' 패키지 + 동반 컬럼
const pkgs = await q(`
  SELECT id, customer_id, total_amount, consultation_fee, created_at,
         total_sessions, paid_amount, transferred_from, status, package_name
  FROM public.packages
  WHERE customer_id = '${cid}' AND clinic_id = '${clinicId}' AND status = 'active';`);
out.active_packages = pkgs;

// 3) package_payments (해당 패키지들)
const pkgIds = pkgs.map((p) => p.id);
const pays = pkgIds.length ? await q(`
  SELECT package_id, amount, payment_type, fee_kind
  FROM public.package_payments WHERE package_id IN (${pkgIds.map((x) => `'${x}'`).join(',')});`) : [];
const payByPkg = new Map();
for (const p of pays) { const a = payByPkg.get(p.package_id) ?? []; a.push(p); payByPkg.set(p.package_id, a); }

// 4) loadCustomerOutstanding 재현 → 고객 packageDue/consultationDue
let packageDue = 0, consultationDue = 0;
const perPkg = [];
for (const pkg of pkgs) {
  const rows = payByPkg.get(pkg.id);
  const effNet = effectiveNetPaid(pkg, rows);
  const pkgDue = computeOutstanding(pkg.total_amount, effNet);
  const consultDue = computeOutstanding(pkg.consultation_fee ?? 0, netPaidFromPayments(rows, 'consultation'));
  if (pkgDue > 0) packageDue += pkgDue;
  if (consultDue > 0) consultationDue += consultDue;
  perPkg.push({
    package_id: pkg.id, name: pkg.package_name, status: pkg.status,
    total_amount: pkg.total_amount, total_sessions: pkg.total_sessions,
    paid_amount: pkg.paid_amount, transferred_from: pkg.transferred_from,
    package_payments_count: (rows?.length ?? 0),
    effectiveNetPaid: effNet, pkgDue, consultDue,
    fallback_hit: (rows?.length ?? 0) === 0 && (isSinglePaymentByCount(pkg.total_sessions) || !!pkg.transferred_from),
  });
}
out.per_package = perPkg;
out.customer_outstanding = { packageDue, consultationDue };

// 5) 대조: R1 이전(구산식, package_payments only) outstanding
let packageDue_PRE = 0;
for (const pkg of pkgs) {
  const rows = payByPkg.get(pkg.id);
  const preDue = computeOutstanding(pkg.total_amount, netPaidFromPayments(rows, 'package'));
  if (preDue > 0) packageDue_PRE += preDue;
}
out.pre_R1_packageDue = packageDue_PRE;   // R1 이전엔 phantom 500,000
out.post_R1_packageDue = packageDue;      // R1 이후 0 기대

out.VERDICT = {
  prod_outstanding_zero: packageDue === 0 && consultationDue === 0,
  phantom_healed_by_R1: packageDue_PRE === 500000 && packageDue === 0,
};

const path = 'rollback/T-20260717-foot-F4857_R1_verify_evidence.json';
writeFileSync(path, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
console.log('\n>>> evidence written:', path);
