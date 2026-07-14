/** T-20260714-foot-DAILYCLOSE-MISU-NOSYNC — READ-ONLY live prod probe (freeze re-verify). */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,
    { method:'POST', headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'}, body:JSON.stringify({query:sql}) });
  const t = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`); return JSON.parse(t);
}
const out = {};
out.void_cols = await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='closing_manual_payments' AND column_name IN ('voided_at','voided_reason','voided_by');`);
out.cmp_d993 = await q(`SELECT id, close_date, chart_number, customer_name, amount, method, memo, created_at FROM public.closing_manual_payments WHERE id='d993ffc5-0000-0000-0000-000000000000' OR id::text LIKE 'd993ffc5%';`);
out.cmp_f4695_today = await q(`SELECT id, close_date, chart_number, customer_name, amount, method, memo, created_at FROM public.closing_manual_payments WHERE (chart_number='F-4695' OR customer_name='이미현') ORDER BY created_at DESC;`);
out.pkg = await q(`SELECT id, customer_id, package_name, total_amount, consultation_fee, paid_amount, status, created_at FROM public.packages WHERE id::text LIKE 'e55c868d%';`);
out.pkg_payments = await q(`SELECT id, package_id, customer_id, amount, method, payment_type, fee_kind, memo, created_at FROM public.package_payments WHERE package_id::text LIKE 'e55c868d%' ORDER BY created_at DESC;`);
out.f4695_cust = await q(`SELECT id, chart_number, name, clinic_id FROM public.customers WHERE chart_number='F-4695' OR name='이미현' ORDER BY created_at DESC LIMIT 5;`);
console.log(JSON.stringify(out, null, 2));
