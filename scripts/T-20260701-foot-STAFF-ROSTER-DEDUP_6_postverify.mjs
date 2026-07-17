/**
 * T-20260701-foot-STAFF-ROSTER-DEDUP #6 정혜인 — AC-5 POST-VERIFY (READ-ONLY, prod write 0)
 * (1) DUP inbound 참조 4컬럼 전부 0  (2) DUP soft-delete 확인(active=false, name suffix)
 * (3) CANON 무손상(active=true, user_id 유지)  (4) 재귀속 room_assignments 2건 → CANON
 */
import fs from 'fs';
function env(k){for(const f of ['.env.local','.env']){if(!fs.existsSync(f))continue;for(const l of fs.readFileSync(f,'utf8').split('\n')){const m=l.match(new RegExp('^'+k+'=(.*)$'));if(m)return m[1].trim().replace(/^"|"$/g,'');}}return process.env[k]||null;}
const TOKEN=env('SUPABASE_ACCESS_TOKEN'), REF='rxlomoozakkjesdqjtvd';
const DUP='5f141f76-7f72-4560-8a67-bbcdf4938cad';
const CANON='c851fbb1-31ce-4714-b91c-03e9cb8af566';
const CANON_USER='3bd596ca-036b-423c-a4f6-3cbab8083133';
const RA_IDS=['215c9b5b-e5da-4207-81ec-406a5568aed1','bd2ff40c-f5a1-4c0f-af96-266cf0d30311'];
async function sql(query){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query})});const t=await r.text();if(r.status>=300)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}

const q=`select json_build_object(
 'dup_row',(select json_build_object('id',id,'name',name,'active',active,'user_id',user_id) from staff where id='${DUP}'),
 'canon_row',(select json_build_object('id',id,'name',name,'active',active,'user_id',user_id) from staff where id='${CANON}'),
 'ref_duty_roster',(select count(*) from duty_roster where doctor_id='${DUP}'),
 'ref_package_sessions',(select count(*) from package_sessions where performed_by='${DUP}'),
 'ref_room_assignments',(select count(*) from room_assignments where staff_id='${DUP}'),
 'ref_customers',(select count(*) from customers where assigned_staff_id='${DUP}'),
 'reassigned_to_canon',(select coalesce(json_agg(json_build_object('id',id,'staff_id',staff_id) order by id),'[]'::json) from room_assignments where id in ('${RA_IDS[0]}','${RA_IDS[1]}'))
) as v;`;
const s=(await sql(q))[0].v;
console.log('── AC-5 POST-VERIFY ──');
console.log(JSON.stringify(s,null,2));

const inboundTotal=Number(s.ref_duty_roster)+Number(s.ref_package_sessions)+Number(s.ref_room_assignments)+Number(s.ref_customers);
const reassignedOK=(s.reassigned_to_canon||[]).length===2 && s.reassigned_to_canon.every(r=>r.staff_id===CANON);
const checks=[
 ['AC-5(a) DUP inbound 참조 4컬럼 전부 0', inboundTotal===0],
 ['DUP soft-delete active=false', s.dup_row && s.dup_row.active===false],
 ['DUP name 중복정리 마킹', s.dup_row && /\[중복정리 2026-07-18\]/.test(s.dup_row.name)],
 ['AC-5(b) CANON active=true 무손상', s.canon_row && s.canon_row.active===true],
 ['AC-5(b) CANON user_id 유지', s.canon_row && s.canon_row.user_id===CANON_USER],
 ['재귀속 room_assignments 2건 → CANON', reassignedOK],
];
console.log('\n── 검증 ──');
let allPass=true;for(const[n,ok]of checks){console.log(`  ${ok?'✅':'🔴'} ${n}`);if(!ok)allPass=false;}
const out={verified_at:new Date().toISOString(),inbound_total_after:inboundTotal,reassigned_ok:reassignedOK,all_pass:allPass,snapshot:s};
fs.writeFileSync('scripts/T-20260701-foot-STAFF-ROSTER-DEDUP_6_postverify.out.json',JSON.stringify(out,null,2));
console.log('\n'+(allPass?'✅ AC-5 전부 PASS':'🔴 AC-5 실패'));
process.exit(allPass?0:2);
