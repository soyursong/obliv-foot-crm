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
const CUST='5959d346-2f14-4dc6-8bd4-71cc826db8c7';
const CHOI='9172beb7-1294-4153-b549-9eb45d337233';
const out={};
// 1) 박효식 check_ins full state
out.checkins = await q(`SELECT id, status, visit_type, visit_nature, consultant_id, assigned_counselor_id, consultation_done, consult_notify_status, consult_notify_sent_at, consult_notify_by, assignment_consult_type, deleted_at, created_at, status_flag FROM check_ins WHERE customer_id='${CUST}' ORDER BY created_at DESC;`);
// 2) status_flag_history for 박효식 check_ins
out.history = await q(`SELECT id, status, status_flag_history FROM check_ins WHERE customer_id='${CUST}' ORDER BY created_at DESC;`);
// 3) assignment_actions for those check_ins
out.aa = await q(`SELECT aa.id, aa.action_type, aa.role, aa.axis, aa.from_staff_id, aa.to_staff_id, aa.created_by, aa.created_at, aa.reason FROM assignment_actions aa JOIN check_ins ci ON ci.id=aa.check_in_id WHERE ci.customer_id='${CUST}' ORDER BY aa.created_at;`);
console.log(JSON.stringify(out,null,2));
