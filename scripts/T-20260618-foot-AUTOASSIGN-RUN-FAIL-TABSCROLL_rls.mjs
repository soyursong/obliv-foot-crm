/**
 * check_ins UPDATE / assignment_actions INSERT RLS 정책 + 오늘 미배정 건 simulate. READ-ONLY(쓰기 안 함).
 */
import { createClient } from '@supabase/supabase-js';
const URL='https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY=(process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const FOOT='74967aea-a60b-4da3-a0e7-9c997a930bc8';
const sb=createClient(URL,KEY,{auth:{persistSession:false}});

async function main(){
  // RLS 정책 덤프
  console.log('=== RLS policies: check_ins / assignment_actions ===');
  const { data: pols, error } = await sb.rpc('exec_sql', { sql:
    "select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where tablename in ('check_ins','assignment_actions') order by tablename, cmd;" });
  if (error) {
    console.log('  exec_sql RPC 없음:', error.message, '— pg_policies 직접조회 시도');
  } else {
    console.table(pols);
  }

  // 오늘 미배정 건 상세 (customer 지정담당 포함)
  const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const { data: ci } = await sb.from('check_ins')
    .select('id, customer_id, customer_name, status, consultant_id, therapist_id, visit_type, treatment_kind, treatment_category, status_flag, checked_in_at')
    .eq('clinic_id',FOOT).gte('checked_in_at',`${today}T00:00:00+09:00`)
    .not('status','in','(done,cancelled)').order('checked_in_at');
  console.log(`\n=== 오늘 활성 체크인 ${ci?.length??0}건 상세 ===`);
  for (const c of (ci??[])) {
    console.log(`- ${c.customer_name} | status=${c.status} | consultant_id=${c.consultant_id??'∅'} | therapist_id=${c.therapist_id??'∅'} | visit_type=${c.visit_type}`);
  }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
