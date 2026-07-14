/**
 * T-20260715-foot-REVENUE-ATTRIB-AXIS-UNIFY — AC2.3 착수시점 T1 자가확인 (READ-ONLY prod)
 * 게이트: DA-20260715-foot-REVENUE-ATTRIB-AXIS-UNIFY §2 T1 — 착수 시점 재측정에서
 *   divergent 발생 & 월 총매출순 이동 ≥1% 또는 ≥1,000,000원 이면 배포 전 대표 게이트 승격.
 *   미발동이면 supervisor 회귀·소급 대사로 충분(대표 게이트 불요).
 * 대상: payments, package_payments 전수 — accounting_date vs (created_at AT TIME ZONE 'Asia/Seoul')::date
 * author: dev-foot / 2026-07-15
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

// A) divergence 전수 (acct != created KST, or acct NULL)
out.divergence = await q(`
  SELECT 'payments' tbl,
    count(*) total,
    count(*) FILTER (WHERE accounting_date IS DISTINCT FROM (created_at AT TIME ZONE 'Asia/Seoul')::date) divergent,
    count(*) FILTER (WHERE accounting_date IS NULL) acct_null
  FROM payments
  UNION ALL
  SELECT 'package_payments',
    count(*),
    count(*) FILTER (WHERE accounting_date IS DISTINCT FROM (created_at AT TIME ZONE 'Asia/Seoul')::date),
    count(*) FILTER (WHERE accounting_date IS NULL)
  FROM package_payments;`);

// B) 월별 총매출순 (net = payment - refund), payments+package_payments 합산, 두 축 대조
out.monthly = await q(`
  WITH allpay AS (
    SELECT created_at, accounting_date, payment_type, amount FROM payments
    UNION ALL
    SELECT created_at, accounting_date, payment_type, amount FROM package_payments
  )
  SELECT
    to_char((created_at AT TIME ZONE 'Asia/Seoul')::date,'YYYY-MM') AS created_month,
    SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END)::bigint AS created_axis_net,
    NULL::text AS sep,
    to_char(accounting_date,'YYYY-MM') AS acct_month,
    SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END)::bigint AS acct_axis_grouped_by_created
  FROM allpay
  GROUP BY 1,4
  ORDER BY 1;`);

// C) 축별 월 총매출순을 각각 독립 집계(진짜 축 이동 확인)
out.by_created = await q(`
  WITH allpay AS (
    SELECT created_at, payment_type, amount FROM payments
    UNION ALL SELECT created_at, payment_type, amount FROM package_payments
  )
  SELECT to_char((created_at AT TIME ZONE 'Asia/Seoul')::date,'YYYY-MM') m,
    SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END)::bigint net
  FROM allpay GROUP BY 1 ORDER BY 1;`);
out.by_acct = await q(`
  WITH allpay AS (
    SELECT accounting_date, payment_type, amount FROM payments
    UNION ALL SELECT accounting_date, payment_type, amount FROM package_payments
  )
  SELECT to_char(accounting_date,'YYYY-MM') m,
    SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END)::bigint net
  FROM allpay GROUP BY 1 ORDER BY 1;`);

// D) live prosrc of the two target functions (CREATE OR REPLACE base 검증)
out.prosrc = await q(`
  SELECT p.proname, pg_get_function_identity_arguments(p.oid) args,
         md5(pg_get_functiondef(p.oid)) def_md5
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('foot_stats_revenue','foot_stats_by_category')
  ORDER BY 1;`);

console.log(JSON.stringify(out,null,2));
