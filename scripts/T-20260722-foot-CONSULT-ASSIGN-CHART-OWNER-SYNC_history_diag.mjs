// T-20260722-foot-CONSULT-ASSIGN-CHART-OWNER-SYNC — READ-ONLY history diagnosis (extension)
// 김종민 초진 배정 이력(assignment_actions) + 강경민 오늘 배정 여부 + 로스터 vs 실제 경로.
// NO WRITES. service role select only.
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env={};
for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}
const admin=createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const today='2026-07-22';
const KANG='6ab26d9f-fd10-4042-9fd7-076f277be5d4'; // 강경민
const EOM='b311593d-9e46-4ac8-9424-6b0fa1689a06';  // 엄경은
const KIM_CI='c391f00b-c3ba-4860-9d15-d4a7f03bba0f'; // 김종민 check_in
const clinicId='74967aea-a60b-4da3-a0e7-9c997a930bc8';

console.log('== history diag / today(KST):', today, '==\n');

// staff name map
const {data:allStaff}=await admin.from('staff').select('id,name,role').eq('clinic_id',clinicId);
const nm=id=>((allStaff??[]).find(s=>s.id===id)?.name)??id;

// 1) 김종민 check_in 배정 이력 전체
const {data:acts, error:e1}=await admin.from('assignment_actions')
  .select('id, action_type, role, axis, from_staff_id, to_staff_id, reason, created_at')
  .eq('check_in_id', KIM_CI).order('created_at',{ascending:true});
console.log('1) 김종민 check_in assignment_actions:', e1?.message ?? '');
for(const a of (acts??[])){
  console.log(`   [${a.created_at}] ${a.action_type} role=${a.role} axis=${a.axis} from=${a.from_staff_id?nm(a.from_staff_id):'-'} → to=${a.to_staff_id?nm(a.to_staff_id):'-'} reason=${a.reason??'-'}`);
}
if(!(acts??[]).length) console.log('   (이력 없음 — INSERT 시점 consultant 직접세팅 후 assignment_actions 미기록 가능)');

// 2) 강경민에게 오늘 배정된 check_ins 있나?
const {data:kangCI, error:e2}=await admin.from('check_ins')
  .select('id, customer_name, visit_type, status, consultant_id, checked_in_at').eq('clinic_id',clinicId)
  .eq('consultant_id',KANG)
  .gte('checked_in_at', today+'T00:00:00+09:00').lte('checked_in_at', today+'T23:59:59+09:00');
console.log('\n2) 강경민(consultant) 오늘 배정 check_ins:', e2?.message ?? (kangCI??[]).length+'건');
for(const c of (kangCI??[])) console.log(`   - ${c.customer_name} visit=${c.visit_type} status=${c.status}`);

// 3) 강경민 관련 assignment_actions 오늘 전체 (to 또는 from)
const {data:kangActs, error:e3}=await admin.from('assignment_actions')
  .select('check_in_id, action_type, role, from_staff_id, to_staff_id, reason, created_at').eq('clinic_id',clinicId)
  .or(`to_staff_id.eq.${KANG},from_staff_id.eq.${KANG}`)
  .gte('created_at', today+'T00:00:00+09:00').order('created_at',{ascending:true});
console.log('\n3) 강경민 관련 assignment_actions 오늘:', e3?.message ?? (kangActs??[]).length+'건');
for(const a of (kangActs??[])) console.log(`   [${a.created_at}] ci=${a.check_in_id.slice(0,8)} ${a.action_type} from=${a.from_staff_id?nm(a.from_staff_id):'-'}→to=${a.to_staff_id?nm(a.to_staff_id):'-'} reason=${a.reason??'-'}`);

// 4) room_assignments 강경민 오늘 (모든 room_type)
const {data:kangRA, error:e4}=await admin.from('room_assignments')
  .select('room_type, staff_name, date').eq('clinic_id',clinicId).eq('date',today).eq('staff_id',KANG);
console.log('\n4) room_assignments 강경민 오늘(모든 room_type):', e4?.message ?? JSON.stringify(kangRA));

// 5) room_assignments 오늘 전체(로스터 전모)
const {data:allRA, error:e5}=await admin.from('room_assignments')
  .select('room_type, staff_id, staff_name').eq('clinic_id',clinicId).eq('date',today).order('room_type');
console.log('\n5) room_assignments 오늘 전체 로스터:', e5?.message ?? '');
for(const r of (allRA??[])) console.log(`   - [${r.room_type}] ${r.staff_name??nm(r.staff_id)}`);

console.log('\n== END history diag ==');
