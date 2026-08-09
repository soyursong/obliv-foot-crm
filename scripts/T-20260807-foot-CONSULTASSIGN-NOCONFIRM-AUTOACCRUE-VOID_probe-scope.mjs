import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1].trim();
const REF='rxlomoozakkjesdqjtvd';
async function q(sql){
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{
    method:'POST', headers:{'Authorization':`Bearer ${tok}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql}) });
  const t = await r.text(); if(!r.ok) throw new Error(`HTTP ${r.status}: ${t}`); return JSON.parse(t);
}
const CHOI='9172beb7-1294-4153-b549-9eb45d337233';
const out={};
// A) 최현희 이번달 배정 check_ins — 미상담(consultation_done=false)+미확정(consult_notify_status null) 을 status별로
out.choi_month = await q(`
  SELECT status,
         (deleted_at IS NOT NULL) as soft_deleted,
         count(*) n,
         count(*) FILTER (WHERE consultation_done=false AND consult_notify_status IS NULL) as unconsulted_unconfirmed
  FROM check_ins
  WHERE consultant_id='${CHOI}'
    AND created_at >= '2026-08-01T00:00:00+09:00'
  GROUP BY status, (deleted_at IS NOT NULL) ORDER BY status;`);
// B) 전 상담사 이번달: consultant_id 배정된 check_in 중 미상담+미확정 규모 (오염 후보 전체)
out.all_month = await q(`
  SELECT s.name,
         count(*) FILTER (WHERE ci.consultation_done=false AND ci.consult_notify_status IS NULL AND ci.status<>'cancelled' AND ci.deleted_at IS NULL) as active_phantom,
         count(*) FILTER (WHERE ci.consultation_done=false AND ci.consult_notify_status IS NULL) as any_phantom,
         count(*) as total_assigned
  FROM check_ins ci JOIN staff s ON s.id=ci.consultant_id
  WHERE ci.created_at >= '2026-08-01T00:00:00+09:00'
  GROUP BY s.name ORDER BY any_phantom DESC;`);
// C) assignment_actions 축 오염: 최현희 이번달 auto_assign 행 vs 그 중 대응 check_in 이 cancelled/deleted/미상담인 비율
out.aa_choi = await q(`
  SELECT aa.action_type,
         count(*) total,
         count(*) FILTER (WHERE ci.status='cancelled' OR ci.deleted_at IS NOT NULL) as ci_cancelled_or_deleted,
         count(*) FILTER (WHERE ci.consultation_done=false AND ci.consult_notify_status IS NULL) as ci_unconsulted_unconfirmed
  FROM assignment_actions aa LEFT JOIN check_ins ci ON ci.id=aa.check_in_id
  WHERE aa.to_staff_id='${CHOI}' AND aa.created_at >= '2026-08-01T00:00:00+09:00'
  GROUP BY aa.action_type;`);
// D) 오늘(08-07) 최현희 배정 상세
out.choi_today = await q(`
  SELECT ci.customer_name, ci.status, ci.consultation_done, ci.consult_notify_status, ci.deleted_at, ci.created_at
  FROM check_ins ci WHERE ci.consultant_id='${CHOI}' AND ci.created_at >= '2026-08-07T00:00:00+09:00' ORDER BY ci.created_at;`);
console.log(JSON.stringify(out,null,2));
