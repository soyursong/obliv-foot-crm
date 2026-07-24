import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}
const CL="74967aea-a60b-4da3-a0e7-9c997a930bc8";
const out={};

// RPC 실제 호출 (7월) — 화면에 실제 잡히는 total_amount 합
out.rpc_july = await q(`
  SELECT sum(total_amount) rpc_total, sum(ticketing_count) tk, count(*) rows
  FROM foot_stats_consultant('${CL}','2026-07-01','2026-07-31');`);

// 실제 net 매출 (package_payments + payments, 7월) — day-close 급 전체
out.actual_july = await q(`
  WITH pp AS (
    SELECT sum(CASE WHEN payment_type='refund' THEN -amount ELSE amount END) v
    FROM package_payments WHERE clinic_id='${CL}' AND accounting_date BETWEEN '2026-07-01' AND '2026-07-31'
  ), pay AS (
    SELECT sum(CASE WHEN payment_type='refund' THEN -amount ELSE amount END) v
    FROM payments WHERE clinic_id='${CL}' AND accounting_date BETWEEN '2026-07-01' AND '2026-07-31'
      AND COALESCE(status,'active') NOT IN ('deleted','cancelled') AND deleted_at IS NULL
  )
  SELECT (SELECT v FROM pp) pkg_net, (SELECT v FROM pay) single_net,
         (SELECT v FROM pp)+(SELECT v FROM pay) grand_net;`);

// 단건결제 net 잡히는/누락 (refund 반영)
out.single_net_split = await q(`
  WITH ticketed_all AS (
    SELECT DISTINCT ci.id AS check_in_id, ci.consultant_id
    FROM check_ins ci JOIN status_transitions st ON st.check_in_id=ci.id
    WHERE ci.clinic_id='${CL}' AND ci.consultant_id IS NOT NULL AND st.to_status='consultation'
  )
  SELECT (ta.consultant_id IS NOT NULL) mapped,
         sum(CASE WHEN pay.payment_type='refund' THEN -pay.amount ELSE pay.amount END) net,
         count(*) n
  FROM payments pay LEFT JOIN ticketed_all ta ON ta.check_in_id=pay.check_in_id
  WHERE pay.clinic_id='${CL}' AND pay.accounting_date BETWEEN '2026-07-01' AND '2026-07-31'
    AND COALESCE(pay.status,'active') NOT IN ('deleted','cancelled') AND pay.deleted_at IS NULL
    AND pay.package_id IS NULL
  GROUP BY 1 ORDER BY 1;`);

console.log(JSON.stringify(out,null,2));
