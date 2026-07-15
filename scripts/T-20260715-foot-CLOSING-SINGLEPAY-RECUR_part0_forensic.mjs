/**
 * T-20260715-foot-CLOSING-SINGLEPAY-F4716-CHARTMATCH-RECUR — Part0 전수 조회 (READ-ONLY forensic)
 * 목적: 2026-07-15 결제 전수를 closing_manual_payments / payments / package_payments 3자 대조.
 *   "마감엔 등록됐으나 차트 수납 미연동 + 미수 잔존" 규모·귀속경로 분포 측정.
 *   RC 판별: default 'manual' path(closing_manual_payments only) vs canonical vs mis-routing.
 * author: dev-foot / 2026-07-15  (신규 prod write 0 — SELECT only)
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
const D = '2026-07-15';

console.log('======== Part0 전수 조회 (READ-ONLY) — 2026-07-15 ========\n');

// 0. 오늘 closing_manual_payments (default 'manual' path = 비연동 후보)
const cmp = await q(`
  SELECT id, close_date, pay_time, chart_number, customer_name, visit_type, staff_name, amount, method, memo, created_at
  FROM public.closing_manual_payments
  WHERE close_date = '${D}'
  ORDER BY pay_time NULLS LAST, created_at;`);
console.log(`[A] closing_manual_payments (close_date=${D}) = ${cmp.length}건`);
console.table(cmp.map(r => ({ chart: r.chart_number, name: r.customer_name, amt: r.amount, method: r.method, visit: r.visit_type, staff: r.staff_name, time: r.pay_time })));

// 1. 오늘 payments (canonical single/checkin)
const pay = await q(`
  SELECT p.id, p.customer_id, p.check_in_id, p.amount, p.method, p.payment_type, p.memo, p.created_at,
         c.chart_number, c.name AS cust_name
  FROM public.payments p
  LEFT JOIN public.customers c ON c.id = p.customer_id
  WHERE p.created_at >= '${D}T00:00:00+09:00' AND p.created_at < '${D}T23:59:59+09:00'
  ORDER BY p.created_at;`);
console.log(`\n[B] payments (created_at ${D}) = ${pay.length}건`);
console.table(pay.map(r => ({ chart: r.chart_number, name: r.cust_name, amt: r.amount, method: r.method, type: r.payment_type, ci: r.check_in_id ? 'checkin' : 'single', memo: (r.memo||'').slice(0,20) })));

// 2. 오늘 package_payments (canonical package)
const pp = await q(`
  SELECT pp.id, pp.package_id, pp.customer_id, pp.amount, pp.method, pp.payment_type, pp.fee_kind, pp.memo, pp.created_at,
         c.chart_number, c.name AS cust_name, pk.package_name
  FROM public.package_payments pp
  LEFT JOIN public.customers c ON c.id = pp.customer_id
  LEFT JOIN public.packages pk ON pk.id = pp.package_id
  WHERE pp.created_at >= '${D}T00:00:00+09:00' AND pp.created_at < '${D}T23:59:59+09:00'
  ORDER BY pp.created_at;`);
console.log(`\n[C] package_payments (created_at ${D}) = ${pp.length}건`);
console.table(pp.map(r => ({ chart: r.chart_number, name: r.cust_name, amt: r.amount, method: r.method, type: r.payment_type, pkg: r.package_name, memo: (r.memo||'').slice(0,20) })));

// 3. F-4716 김희정 대표 케이스 심층
console.log('\n======== F-4716 김희정 심층 ========');
const cust = await q(`SELECT id, chart_number, name, phone, clinic_id FROM public.customers WHERE chart_number='F-4716';`);
console.log('customer:', JSON.stringify(cust, null, 2));
if (cust.length === 1) {
  const cid = cust[0].id;
  const cpk = await q(`SELECT id, package_name, status, total_sessions, total_price, paid_amount, created_at FROM public.packages WHERE customer_id='${cid}' ORDER BY created_at DESC;`);
  console.log('\npackages:'); console.table(cpk.map(r=>({name:r.package_name,status:r.status,sess:r.total_sessions,price:r.total_price,paid:r.paid_amount,due:(r.total_price||0)-(r.paid_amount||0)})));
  const cpay = await q(`SELECT id, amount, method, payment_type, check_in_id, memo, created_at FROM public.payments WHERE customer_id='${cid}' ORDER BY created_at DESC LIMIT 10;`);
  console.log('\npayments(canonical):'); console.table(cpay);
  const cpp = await q(`SELECT id, package_id, amount, payment_type, fee_kind, memo, created_at FROM public.package_payments WHERE customer_id='${cid}' ORDER BY created_at DESC LIMIT 10;`);
  console.log('\npackage_payments(canonical):'); console.table(cpp);
  const ccmp = await q(`SELECT id, close_date, amount, method, visit_type, memo, created_at FROM public.closing_manual_payments WHERE chart_number='F-4716' ORDER BY created_at DESC LIMIT 10;`);
  console.log('\nclosing_manual_payments(F-4716):'); console.table(ccmp);
}

// 4. 요약: RC 판별
console.log('\n======== RC 판별 요약 ========');
const cmpTotal = cmp.reduce((s,r)=>s+Number(r.amount||0),0);
const payTotal = pay.reduce((s,r)=>s+Number(r.amount||0),0);
const ppTotal = pp.reduce((s,r)=>s+Number(r.amount||0),0);
console.log(`오늘 closing_manual_payments: ${cmp.length}건 / ₩${cmpTotal.toLocaleString()}  <- default 'manual'(비연동) 경로`);
console.log(`오늘 payments(canonical):     ${pay.length}건 / ₩${payTotal.toLocaleString()}`);
console.log(`오늘 package_payments:        ${pp.length}건 / ₩${ppTotal.toLocaleString()}`);
console.log(`\n판별: closing_manual_payments 비중이 압도적이면 → default 'manual' 경로가 RC(전수 비연동).`);

// 5. closing_manual_payments 중 차트번호가 실제 고객으로 해소되는데도 canonical 미생성인 건 (정정 대상 후보)
const orphans = await q(`
  SELECT cmp.id, cmp.chart_number, cmp.customer_name, cmp.amount, cmp.method, cmp.visit_type, cmp.pay_time, cmp.close_date,
         c.id AS cust_id, c.name AS matched_name
  FROM public.closing_manual_payments cmp
  JOIN public.customers c ON c.chart_number = cmp.chart_number AND c.clinic_id = (SELECT clinic_id FROM public.customers WHERE chart_number = cmp.chart_number LIMIT 1)
  WHERE cmp.close_date = '${D}' AND cmp.chart_number IS NOT NULL
  ORDER BY cmp.pay_time;`);
console.log(`\n[D] 정정 대상 후보 (오늘 closing_manual_payments 중 차트번호가 고객으로 해소되는 건) = ${orphans.length}건`);
console.table(orphans.map(r=>({chart:r.chart_number, cmpName:r.customer_name, matched:r.matched_name, amt:r.amount, visit:r.visit_type, time:r.pay_time})));
