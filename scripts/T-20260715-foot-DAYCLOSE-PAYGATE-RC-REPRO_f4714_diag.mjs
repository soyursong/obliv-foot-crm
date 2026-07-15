/**
 * T-20260715-foot-DAYCLOSE-PAYGATE-RC-REPRO — F-4714 정밀 RC 진단 (READ-ONLY, prod)
 *
 * 목적: 총괄 테스트 건 F-4714 가 일마감 결제목록/시술통계에 왜 뜨는지 데이터로 확정.
 *   총괄 증언: "해당 건 결제 한 적 없어(실결제 0건)".
 *
 * 분기 판정 근거 (추정 패치 금지 — read-only):
 *   D0 customers → customer_id 해석 (chart_number=customers/closing_manual_payments 에만 존재)
 *   D1 check_ins: status/completed_at/status_flag/status_flag_history
 *   D2 실결제 3종(payments / package_payments / closing_manual_payments)
 *   D3 check_in_services: 시술/price 행
 *
 * author: dev-foot / 2026-07-15
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
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
const CHART = 'F-4714';
const dump = (label, rows) => { console.log(`\n=== ${label} (${rows.length}행) ===`); console.log(JSON.stringify(rows, null, 2)); };
const colsOf = async (t) => (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='${t}';`)).map(c=>c.column_name);

// ── D0. customers → customer_id
const cust = await q(`SELECT id, chart_number, name, created_at FROM public.customers WHERE chart_number='${CHART}';`);
dump('D0 customers (F-4714)', cust);
if (!cust.length) { console.log('\n⚠ F-4714 customers 행 없음 — 진단 중단'); process.exit(0); }
const custIds = cust.map(r=>`'${r.id}'`).join(',');

// ── D1. check_ins 본행
const ci = await q(`
  SELECT id, customer_id, customer_name, status, status_flag, visit_type, treatment_kind,
         created_at, checked_in_at, completed_at, status_flag_history, clinic_id, package_id
  FROM public.check_ins WHERE customer_id IN (${custIds}) ORDER BY created_at;`);
dump('D1 check_ins 본행', ci);
const ciIds = ci.map(r => `'${r.id}'`).join(',') || `'00000000-0000-0000-0000-000000000000'`;

// ── D2a. payments
const payCols = await colsOf('payments');
const pw = [`customer_id IN (${custIds})`];
if (payCols.includes('check_in_id')) pw.push(`check_in_id IN (${ciIds})`);
const payments = await q(`SELECT * FROM public.payments WHERE ${pw.join(' OR ')} ORDER BY created_at;`);
dump('D2a payments 실결제', payments);

// ── D2b. package_payments
const ppCols = await colsOf('package_payments');
const ppw = [];
if (ppCols.includes('customer_id')) ppw.push(`customer_id IN (${custIds})`);
if (ppCols.includes('check_in_id')) ppw.push(`check_in_id IN (${ciIds})`);
const pp = ppw.length ? await q(`SELECT * FROM public.package_payments WHERE ${ppw.join(' OR ')} ORDER BY created_at;`) : [];
dump('D2b package_payments', pp);

// ── D2c. closing_manual_payments
const cmp = await q(`SELECT * FROM public.closing_manual_payments WHERE chart_number='${CHART}' ORDER BY pay_time;`);
dump('D2c closing_manual_payments', cmp);

// ── D3. check_in_services
const cisExists = await q(`SELECT to_regclass('public.check_in_services') AS t;`);
if (cisExists[0].t) {
  const cis = await q(`SELECT * FROM public.check_in_services WHERE check_in_id IN (${ciIds}) ORDER BY created_at;`);
  dump('D3 check_in_services (시술/price)', cis);
} else {
  console.log('\n=== D3 check_in_services: 테이블 없음 ===');
}

// ── 판정 요약
const sum = (rows, keys) => rows.reduce((s,r)=>{ for (const k of keys) if (r[k]!=null) return s+Number(r[k]); return s; },0);
const payTotal = sum(payments, ['amount','paid_amount','total_amount']);
const ppTotal = sum(pp, ['amount']);
const cmpTotal = sum(cmp, ['amount']);
console.log('\n================ 분기 판정 근거 요약 ================');
console.log(JSON.stringify({
  chart: CHART, customer_ids: cust.map(r=>r.id),
  check_ins_행수: ci.length, check_ins_status: ci.map(r=>r.status), check_ins_status_flag: ci.map(r=>r.status_flag),
  payments_행수: payments.length, payments_합계: payTotal,
  package_payments_행수: pp.length, package_payments_합계: ppTotal,
  closing_manual_payments_행수: cmp.length, closing_manual_payments_합계: cmpTotal,
  실결제3종_총합: payTotal + ppTotal + cmpTotal,
}, null, 2));
