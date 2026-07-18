/**
 * T-20260701-foot-STAFF-ROSTER-DEDUP #1 박소예 — AC-5 POST-VERIFY (READ-ONLY, prod write 0)
 * DA yij8 필수 단언:
 *  - 박소예 활성행 정확히 1개 = 5fb3e3b1 (활성-count 불변식, 조건2)
 *  - 5fb3e3b1 active=true AND user_id 유지(833c7135)
 *  - 5c17e4bc active=false + '[중복정리]' 마킹
 *  - DUP inbound 4컬럼 전부 0
 *  - 재귀속 건수 = freeze 매니페스트 컬럼별 합 일치 (frozen id셋이 CANON 귀속)
 *  - customers 영향 환자셋 CANON 귀속 (orphan0·타인leak0)
 */
import fs from 'fs';
function env(k){for(const f of ['.env.local','.env']){if(!fs.existsSync(f))continue;for(const l of fs.readFileSync(f,'utf8').split('\n')){const m=l.match(new RegExp('^'+k+'=(.*)$'));if(m)return m[1].trim().replace(/^"|"$/g,'');}}return process.env[k]||null;}
const TOKEN=env('SUPABASE_ACCESS_TOKEN'), REF='rxlomoozakkjesdqjtvd';
const {manifest:M}=JSON.parse(fs.readFileSync('scripts/T-20260701-foot-STAFF-ROSTER-DEDUP_1_fresh_snapshot.out.json','utf8'));
const DUP=M.dup, CANON=M.canon, CANON_USER=M.canon_user, F=M.per_column_freeze;
const inList=a=>a.length?a.map(x=>`'${x}'`).join(','):`'00000000-0000-0000-0000-000000000000'`;
async function sql(query){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query})});const t=await r.text();if(r.status>=300)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}

const q=`select json_build_object(
 'dup_row',(select json_build_object('id',id,'name',name,'active',active,'user_id',user_id) from staff where id='${DUP}'),
 'canon_row',(select json_build_object('id',id,'name',name,'active',active,'user_id',user_id) from staff where id='${CANON}'),
 'active_soye',(select coalesce(json_agg(json_build_object('id',id,'name',name)),'[]'::json) from staff where name like '박소예%' and active=true),
 -- DUP 잔여 inbound (전부 0 이어야)
 'dup_ref_duty',(select count(*) from duty_roster where doctor_id='${DUP}'),
 'dup_ref_pkg', (select count(*) from package_sessions where performed_by='${DUP}'),
 'dup_ref_room',(select count(*) from room_assignments where staff_id='${DUP}'),
 'dup_ref_cust',(select count(*) from customers where assigned_staff_id='${DUP}'),
 -- frozen id셋이 CANON 귀속 확인 (재귀속 건수 대사)
 'reattr_duty_to_canon',(select count(*) from duty_roster where id in (${inList(M.dup_duty_ids)}) and doctor_id='${CANON}'),
 'reattr_pkg_to_canon', (select count(*) from package_sessions where id in (${inList(M.dup_pkg_ids)}) and performed_by='${CANON}'),
 'reattr_room_to_canon',(select count(*) from room_assignments where id in (${inList(M.dup_room_ids)}) and staff_id='${CANON}'),
 -- CANON 총 귀속 (leak 대조: DUP set ∪ CANON before)
 'canon_ref_duty',(select count(*) from duty_roster where doctor_id='${CANON}'),
 'canon_ref_pkg', (select count(*) from package_sessions where performed_by='${CANON}'),
 'canon_ref_room',(select count(*) from room_assignments where staff_id='${CANON}'),
 'canon_ref_cust',(select count(*) from customers where assigned_staff_id='${CANON}'),
 'canon_cust_ids',(select coalesce(json_agg(id order by id),'[]'::json) from customers where assigned_staff_id='${CANON}')
) as v;`;
const s=(await sql(q))[0].v;
console.log('── #1 박소예 AC-5 POST-VERIFY ──');
console.log(JSON.stringify(s,null,2));

const dupInbound=Number(s.dup_ref_duty)+Number(s.dup_ref_pkg)+Number(s.dup_ref_room)+Number(s.dup_ref_cust);
// customers leak 대조: CANON 귀속 환자셋 = (before ∪ dup set). 둘 다 [] → CANON customers 0.
const expectCanonCust=[...new Set([...(M.canon_customer_ids_before||[]),...(M.dup_customer_ids||[])])].sort();
const gotCanonCust=[...(s.canon_cust_ids||[])].sort();
const custSetOK=JSON.stringify(expectCanonCust)===JSON.stringify(gotCanonCust);

const checks=[
 ['활성-count 불변식: 박소예 활성행 정확히 1', (s.active_soye||[]).length===1],
 ['그 1행 = CANON 5fb3e3b1', (s.active_soye||[]).length===1 && s.active_soye[0].id===CANON],
 ['CANON active=true', s.canon_row && s.canon_row.active===true],
 ['CANON user_id 유지=833c7135', s.canon_row && s.canon_row.user_id===CANON_USER],
 ['DUP active=false', s.dup_row && s.dup_row.active===false],
 ['DUP [중복정리] 마킹', s.dup_row && /\[중복정리 2026-07-18\]/.test(s.dup_row.name)],
 ['DUP inbound 4컬럼 전부 0', dupInbound===0],
 [`재귀속 duty ${F.duty_roster}건 CANON 귀속`, Number(s.reattr_duty_to_canon)===F.duty_roster],
 [`재귀속 pkg ${F.package_sessions}건 CANON 귀속`, Number(s.reattr_pkg_to_canon)===F.package_sessions],
 [`재귀속 room ${F.room_assignments}건 CANON 귀속`, Number(s.reattr_room_to_canon)===F.room_assignments],
 ['CANON duty 총계 = freeze+before', Number(s.canon_ref_duty)===F.duty_roster+M.canon_refs_before.duty_roster],
 ['CANON pkg 총계 = freeze+before', Number(s.canon_ref_pkg)===F.package_sessions+M.canon_refs_before.package_sessions],
 ['CANON room 총계 = freeze+before', Number(s.canon_ref_room)===F.room_assignments+M.canon_refs_before.room_assignments],
 ['customers 영향 환자셋 CANON 귀속(orphan0·leak0)', custSetOK],
];
console.log('\n── 검증 ──');
let allPass=true;for(const[n,ok]of checks){console.log(`  ${ok?'✅':'🔴'} ${n}`);if(!ok)allPass=false;}
const out={verified_at:new Date().toISOString(),dup_inbound_after:dupInbound,cust_set_ok:custSetOK,all_pass:allPass,snapshot:s,freeze:F};
fs.writeFileSync('scripts/T-20260701-foot-STAFF-ROSTER-DEDUP_1_postverify.out.json',JSON.stringify(out,null,2));
console.log('\n'+(allPass?'✅ AC-5 전부 PASS':'🔴 AC-5 실패'));
process.exit(allPass?0:2);
