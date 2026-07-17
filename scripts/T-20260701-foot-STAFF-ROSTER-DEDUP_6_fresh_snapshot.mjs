/**
 * T-20260701-foot-STAFF-ROSTER-DEDUP #6 정혜인 — FRESH EXECUTION-TIME SNAPSHOT (READ-ONLY, prod write 0)
 * supervisor DB-GATE-GO(MSG-20260718-012030-291v) 조건: evidence 16d stale → 집행시점 fresh 재조회.
 * 모든 가드가 기대치와 일치할 때만 apply. 하나라도 불일치 → ABORT + supervisor 재게이트.
 */
import fs from 'fs';
function env(k){for(const f of ['.env.local','.env']){if(!fs.existsSync(f))continue;for(const l of fs.readFileSync(f,'utf8').split('\n')){const m=l.match(new RegExp('^'+k+'=(.*)$'));if(m)return m[1].trim().replace(/^"|"$/g,'');}}return process.env[k]||null;}
const TOKEN=env('SUPABASE_ACCESS_TOKEN'), REF='rxlomoozakkjesdqjtvd';
if(!TOKEN){console.error('❌ SUPABASE_ACCESS_TOKEN 없음');process.exit(1);}
const DUP='5f141f76-7f72-4560-8a67-bbcdf4938cad';   // 정혜인 비활성 중복행
const CANON='c851fbb1-31ce-4714-b91c-03e9cb8af566'; // 정연주 재귀속 canonical

async function sql(query){
  const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query})});
  const txt=await r.text();
  if(r.status>=300){throw new Error(`HTTP ${r.status}: ${txt}`);}
  return JSON.parse(txt);
}

const q=`select json_build_object(
 'dup_rows', (select coalesce(json_agg(json_build_object('id',id,'name',name,'active',active,'user_id',user_id,'clinic_id',clinic_id)),'[]'::json) from staff where id='${DUP}'),
 'dup_by_name', (select coalesce(json_agg(json_build_object('id',id,'active',active,'user_id',user_id)),'[]'::json) from staff where name='정혜인'),
 'canon_rows', (select coalesce(json_agg(json_build_object('id',id,'name',name,'active',active,'user_id',user_id)),'[]'::json) from staff where id='${CANON}'),
 'ref_room_assignments', (select count(*) from room_assignments where staff_id='${DUP}'),
 'ref_room_assignment_ids', (select coalesce(json_agg(id order by id),'[]'::json) from room_assignments where staff_id='${DUP}'),
 'ref_duty_roster', (select count(*) from duty_roster where doctor_id='${DUP}'),
 'ref_package_sessions', (select count(*) from package_sessions where performed_by='${DUP}'),
 'ref_customers', (select count(*) from customers where assigned_staff_id='${DUP}')
) as snap;`;

const rows=await sql(q);
const s=rows[0].snap;
console.log('── FRESH SNAPSHOT (execution-time) ──');
console.log(JSON.stringify(s,null,2));

// ── 가드 검증 (기대치 vs 실측) ──
const checks=[];
const dup=s.dup_rows;
checks.push(['DUP 5f141f76 정확히 1행', dup.length===1]);
checks.push(['DUP active=false', dup.length===1 && dup[0].active===false]);
checks.push(['동명이인(정혜인) 총 1행', s.dup_by_name.length===1]);
const canon=s.canon_rows;
checks.push(['CANON c851fbb1 정확히 1행', canon.length===1]);
checks.push(['CANON active=true', canon.length===1 && canon[0].active===true]);
checks.push(['room_assignments 참조 = 2', Number(s.ref_room_assignments)===2]);
checks.push(['duty_roster.doctor_id 참조 = 0', Number(s.ref_duty_roster)===0]);
checks.push(['package_sessions.performed_by 참조 = 0', Number(s.ref_package_sessions)===0]);
checks.push(['customers.assigned_staff_id 참조 = 0', Number(s.ref_customers)===0]);

console.log('\n── 가드 검증 ──');
let allPass=true;
for(const [name,ok] of checks){console.log(`  ${ok?'✅':'🔴'} ${name}`);if(!ok)allPass=false;}

const verdict={
  generated_at:new Date().toISOString(),
  dup_user_id: dup.length===1?dup[0].user_id:null,
  canon_user_id: canon.length===1?canon[0].user_id:null,
  room_assignment_ids: s.ref_room_assignment_ids,
  inbound_total: Number(s.ref_room_assignments)+Number(s.ref_duty_roster)+Number(s.ref_package_sessions)+Number(s.ref_customers),
  all_guards_pass: allPass,
  next: allPass?'GO — apply DO block':'ABORT — supervisor 재게이트',
};
console.log('\n'+JSON.stringify(verdict,null,2));
fs.writeFileSync('scripts/T-20260701-foot-STAFF-ROSTER-DEDUP_6_fresh_snapshot.out.json',JSON.stringify({snapshot:s,verdict},null,2));
if(!allPass){console.error('\n🔴 DRIFT DETECTED — apply 금지, ABORT');process.exit(2);}
console.log('\n✅ 모든 가드 통과 — apply 진행 가능');
