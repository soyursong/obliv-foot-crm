/** Stage1 diag3 — 10:08 배치 check_ins 30건 정밀 격리 + 식별키 확정 (READ-ONLY) */
import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg',{auth:{persistSession:false}});
const CLINIC='74967aea-a60b-4da3-a0e7-9c997a930bc8';
const T=ts=>ts?new Date(new Date(ts).getTime()+9*3600*1000).toISOString().slice(0,19).replace('T',' '):null;
async function main(){
  // 후보 식별키: reservation_id NULL + status registered + checked_in_at 오늘
  const { data: ci } = await sb.from('check_ins')
    .select('id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, checked_in_at, completed_at, created_at, notes')
    .eq('clinic_id',CLINIC).is('reservation_id',null).eq('status','registered')
    .gte('checked_in_at','2026-06-16T15:00:00Z').lte('checked_in_at','2026-06-17T15:00:00Z')
    .order('checked_in_at');
  console.log(`[키후보] reservation_id IS NULL + status=registered + checked_in_at 오늘 = ${ci?.length??0}건`);
  // created_at 분포
  const byCreated={};
  for(const c of (ci??[])) { const k=T(c.created_at).slice(0,16); byCreated[k]=(byCreated[k]??0)+1; }
  console.log(`created_at(분) 분포:`, JSON.stringify(byCreated));
  // 정확한 created_at min/max
  const cts=(ci??[]).map(c=>c.created_at).sort();
  console.log(`created_at 범위: ${T(cts[0])} ~ ${T(cts[cts.length-1])}`);

  // customers 상태 확인
  const cids=[...new Set((ci??[]).map(c=>c.customer_id).filter(Boolean))];
  const { data: custs } = await sb.from('customers').select('id,name,phone,is_simulation,created_at').in('id',cids);
  const cm=new Map((custs??[]).map(c=>[c.id,c]));
  let simTrue=0,simFalse=0,orphan=0;
  for(const c of (ci??[])){ const cu=cm.get(c.customer_id); if(!cu)orphan++; else if(cu.is_simulation)simTrue++; else simFalse++; }
  console.log(`\n연결 customers: is_simulation=true ${simTrue} / false ${simFalse} / orphan(없음) ${orphan}`);

  // 연결 reservations 검증 (이 check_ins 가 어떤 예약도 안 건드렸나)
  console.log(`\n── 30건 상세 ──`);
  for(const c of (ci??[])){ const cu=cm.get(c.customer_id);
    console.log(`  ${c.id} | ${c.customer_name} ${c.customer_phone||''} vt=${c.visit_type} chkin=${T(c.checked_in_at)} created=${T(c.created_at)} cust_sim=${cu?cu.is_simulation:'ORPHAN'} cust_created=${cu?T(cu.created_at):'-'}`);
  }

  // 안전성: 이 키가 진짜 현장 체크인(reservation_id 연결)·힐러·김사비 등을 절대 안 잡는지 교차 확인
  const { count: realCnt } = await sb.from('check_ins')
    .select('id',{count:'exact',head:true})
    .eq('clinic_id',CLINIC).not('reservation_id','is',null)
    .gte('checked_in_at','2026-06-16T15:00:00Z').lte('checked_in_at','2026-06-17T15:00:00Z');
  console.log(`\n[교차검증] reservation_id 연결된 오늘 check_ins(=진짜 현장, 키에서 제외됨) ${realCnt}건`);

  console.log(`\n===STAGE3_KEY_JSON===`);
  console.log(JSON.stringify({
    key:"clinic_id=jongno-foot AND reservation_id IS NULL AND status='registered' AND checked_in_at::date(KST)=2026-06-17",
    candidate_count: ci?.length??0,
    created_range:[T(cts[0]),T(cts[cts.length-1])],
    cust_sim_true:simTrue, cust_sim_false:simFalse, orphan,
    real_field_checkins_excluded: realCnt,
    delete_candidate_ids:(ci??[]).map(c=>c.id),
  },null,2));
}
main().catch(e=>{console.error('실패:',e.message);process.exit(1);});
