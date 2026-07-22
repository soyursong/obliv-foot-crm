// T-20260722-foot-CONSULT-ASSIGN-CHART-OWNER-SYNC — READ-ONLY roster diagnosis
// 강경민 실장 휴무 vs room_assignments 상담 로스터 vs 김종민 초진 배정 실제 경로.
// NO WRITES. service role select only.
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env={};
for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}
const admin=createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const today='2026-07-22';

console.log('== project:', env.VITE_SUPABASE_URL, '/ today(KST):', today, '==\n');

// 1) 강경민 staff record
const {data:kang, error:e1}=await admin.from('staff')
  .select('id, name, role, active, clinic_id').ilike('name','%강경민%');
console.log('1) 강경민 staff:', e1?.message ?? JSON.stringify(kang, null, 2));
const kangIds=(kang??[]).map(s=>s.id);
const clinicId=(kang??[])[0]?.clinic_id;

// 2) staff_temp_off today (work_date=today)
const {data:tempOff, error:e2}=await admin.from('staff_temp_off')
  .select('*').eq('work_date', today);
console.log('\n2) staff_temp_off ('+today+', all):', e2?.message ?? JSON.stringify(tempOff, null, 2));
console.log('   → 강경민 temp_off?:', (tempOff??[]).some(t=>kangIds.includes(t.staff_id)) ? 'YES(자동배정 제외 마킹됨)' : 'NO(row 없음)');

// 3) room_assignments consultation today — 강경민 포함 여부
const {data:ra, error:e3}=await admin.from('room_assignments')
  .select('id, staff_id, staff_name, room_type, date').eq('clinic_id', clinicId ?? '')
  .eq('date', today).eq('room_type','consultation');
console.log('\n3) room_assignments consultation('+today+'):', e3?.message ?? JSON.stringify(ra, null, 2));
console.log('   → 강경민 상담 로스터 포함?:', (ra??[]).some(r=>kangIds.includes(r.staff_id)) ? 'YES(assign_consultant_atomic 후보풀에 포함됨)' : 'NO');

// 4) 김종민 오늘 초진 check_in — consultant_id 누구?
const {data:kim, error:e4}=await admin.from('check_ins')
  .select('id, customer_name, visit_type, status, consultant_id, checked_in_at').eq('clinic_id', clinicId ?? '')
  .ilike('customer_name','%김종민%')
  .gte('checked_in_at', today+'T00:00:00+09:00').lte('checked_in_at', today+'T23:59:59+09:00');
console.log('\n4) 김종민 check_ins today:', e4?.message ?? JSON.stringify(kim, null, 2));
// consultant 이름 매핑
const cids=[...new Set((kim??[]).map(c=>c.consultant_id).filter(Boolean))];
let cmap={};
if(cids.length){const {data:cn}=await admin.from('staff').select('id,name').in('id',cids);(cn??[]).forEach(s=>cmap[s.id]=s.name);}
for(const c of (kim??[])){
  console.log(`   → checkin ${c.id.slice(0,8)} visit=${c.visit_type} status=${c.status} consultant=${cmap[c.consultant_id]??c.consultant_id} ${kangIds.includes(c.consultant_id)?'★강경민(휴무자에게 배정됨!)':''}`);
}

// 5) 오늘 assign_consultant_atomic 후보풀(상담 로스터) 전체 + temp_off 대조
console.log('\n5) 오늘 상담 로스터 후보 vs 휴무 대조:');
const offSet=new Set((tempOff??[]).map(t=>t.staff_id));
for(const r of (ra??[])){
  const nm=(r.staff_name)|| (await admin.from('staff').select('name').eq('id',r.staff_id).maybeSingle()).data?.name;
  console.log(`   - ${nm} (${r.staff_id.slice(0,8)}) ${offSet.has(r.staff_id)?'← staff_temp_off 휴무인데 로스터엔 잔존(RPC가 못 거름)':''}`);
}
console.log('\n== END read-only diag ==');
