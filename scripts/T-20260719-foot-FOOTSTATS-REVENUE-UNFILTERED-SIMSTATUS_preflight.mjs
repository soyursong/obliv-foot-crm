/**
 * T-20260719-foot-FOOTSTATS-REVENUE-UNFILTERED-SIMSTATUS — PROD PREFLIGHT (READ-ONLY)
 * AC1 blast-radius + AC2 enum 실재 확인(추정 금지) + AC3 C10 pg_proc PREFLIGHT + AC4 델타 산출
 * DB: rxlomoozakkjesdqjtvd (obliv-foot-crm, foot 단일 Supabase)
 * author: dev-foot / 2026-07-19
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1].trim();
const REF='rxlomoozakkjesdqjtvd';
if(!tok){console.error('no token');process.exit(1);}
async function q(sql){
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{
    method:'POST',
    headers:{'Authorization':`Bearer ${tok}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql})
  });
  const t = await r.text();
  if(!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const out={};
// AC3 C10 — 현행 prod RPC 실 원문 (파일선언 아닌 prod live prosrc)
out.rpc_src = await q(`SELECT p.oid::regprocedure sig, p.provolatile, p.prosecdef, pg_get_functiondef(p.oid) def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='foot_stats_revenue';`);
// AC2 enum 실재 — payments/package_payments CHECK defs (추정 금지)
out.checks = await q(`SELECT c.conname, t.relname tbl, pg_get_constraintdef(c.oid) def FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname IN ('payments','package_payments') AND c.contype='c' ORDER BY t.relname, c.conname;`);
// AC2 컬럼 실재 — status/customer_id on payments·package_payments, is_simulation on customers
out.cols = await q(`SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND ((table_name='payments' AND column_name IN ('status','customer_id','clinic_id','accounting_date')) OR (table_name='package_payments' AND column_name IN ('status','customer_id','clinic_id','accounting_date')) OR (table_name='customers' AND column_name='is_simulation')) ORDER BY table_name, column_name;`);
// AC2 실 데이터 — payments.status distinct 값 (prod에 실제 존재하는 토큰)
out.pay_status = await q(`SELECT status, count(*) n FROM payments GROUP BY status ORDER BY n DESC;`);
// AC1 소비표면 — RPC 호출부는 FE(app); DB단 다른 함수/뷰가 foot_stats_revenue 호출하는지
out.callers = await q(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND pg_get_functiondef(p.oid) ILIKE '%foot_stats_revenue%' AND p.proname<>'foot_stats_revenue';`);
// AC4 델타 — clinic별 현행(무필터) vs 정정(진성) single/pkg 매출 차이
out.delta = await q(`
WITH cl AS (SELECT DISTINCT clinic_id FROM payments WHERE clinic_id IS NOT NULL
            UNION SELECT DISTINCT clinic_id FROM package_payments WHERE clinic_id IS NOT NULL),
cur_s AS (SELECT clinic_id, SUM(CASE WHEN payment_type='payment' THEN amount ELSE 0 END) pay, SUM(CASE WHEN payment_type='refund' THEN amount ELSE 0 END) ref FROM payments GROUP BY 1),
new_s AS (SELECT clinic_id, SUM(CASE WHEN payment_type='payment' THEN amount ELSE 0 END) pay, SUM(CASE WHEN payment_type='refund' THEN amount ELSE 0 END) ref FROM payments pm WHERE status NOT IN ('cancelled','deleted') AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id=pm.customer_id AND c.is_simulation IS TRUE) GROUP BY 1),
cur_p AS (SELECT clinic_id, SUM(CASE WHEN payment_type='payment' THEN amount ELSE 0 END) pay, SUM(CASE WHEN payment_type='refund' THEN amount ELSE 0 END) ref FROM package_payments GROUP BY 1),
new_p AS (SELECT clinic_id, SUM(CASE WHEN payment_type='payment' THEN amount ELSE 0 END) pay, SUM(CASE WHEN payment_type='refund' THEN amount ELSE 0 END) ref FROM package_payments pp WHERE NOT EXISTS (SELECT 1 FROM customers c WHERE c.id=pp.customer_id AND c.is_simulation IS TRUE) GROUP BY 1)
SELECT cl.clinic_id,
  COALESCE(cs.pay,0) cur_single, COALESCE(ns.pay,0) new_single, COALESCE(cs.pay,0)-COALESCE(ns.pay,0) d_single,
  COALESCE(cp.pay,0) cur_pkg,    COALESCE(np.pay,0) new_pkg,    COALESCE(cp.pay,0)-COALESCE(np.pay,0) d_pkg,
  COALESCE(cs.ref,0)+COALESCE(cp.ref,0) cur_refund, COALESCE(ns.ref,0)+COALESCE(np.ref,0) new_refund
FROM cl
LEFT JOIN cur_s cs ON cs.clinic_id=cl.clinic_id LEFT JOIN new_s ns ON ns.clinic_id=cl.clinic_id
LEFT JOIN cur_p cp ON cp.clinic_id=cl.clinic_id LEFT JOIN new_p np ON np.clinic_id=cl.clinic_id
ORDER BY (COALESCE(cs.pay,0)-COALESCE(ns.pay,0))+(COALESCE(cp.pay,0)-COALESCE(np.pay,0)) DESC;`);
console.log(JSON.stringify(out,null,2));
