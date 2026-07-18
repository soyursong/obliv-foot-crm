/**
 * T-20260701-foot-STAFF-ROSTER-DEDUP #1 박소예 — FRESH EXECUTION-TIME SNAPSHOT + FREEZE MANIFEST (READ-ONLY, prod write 0)
 * supervisor DB-GATE-GO(조건부) MSG-20260718-130404-15h7 + DA CONSULT-REPLY MSG-20260718-130145-yij8.
 * evidence 16d+ stale → 집행시점 fresh 재조회 우선. per-column(4컬럼) freeze 매니페스트 생성.
 * Q2 추가 가드 5종 사전 스캔: (a)customers PHI freeze (b)per-column freeze (c)unique collision pre-scan
 *   (d)clinic parity (e)orphan 은닉 부재.
 * 하나라도 불일치/충돌 → ABORT + supervisor 재게이트. aggregate 12 단일대사 금지.
 *
 * ⚠ #1은 #6과 反轉: DUP(5c17e4bc)=active행(폐기대상) / CANON(5fb3e3b1)=inactive행(활성화대상).
 */
import fs from 'fs';
function env(k){for(const f of ['.env.local','.env']){if(!fs.existsSync(f))continue;for(const l of fs.readFileSync(f,'utf8').split('\n')){const m=l.match(new RegExp('^'+k+'=(.*)$'));if(m)return m[1].trim().replace(/^"|"$/g,'');}}return process.env[k]||null;}
const TOKEN=env('SUPABASE_ACCESS_TOKEN'), REF='rxlomoozakkjesdqjtvd';
if(!TOKEN){console.error('❌ SUPABASE_ACCESS_TOKEN 없음');process.exit(1);}
const DUP='5c17e4bc-e948-4dc4-a8cf-37904873edeb';   // 박소예 active행, user_id=null (폐기대상)
const CANON='5fb3e3b1-1c5a-461b-9159-c330a52feb95'; // 박소예 inactive행, up.active=true 실로그인 (canonical, 활성화대상)
const CANON_USER='833c7135-7e26-4743-9679-a95c31573c7f'; // explore 확정치

async function sql(query){
  const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query})});
  const txt=await r.text();
  if(r.status>=300){throw new Error(`HTTP ${r.status}: ${txt}`);}
  return JSON.parse(txt);
}

const q=`select json_build_object(
 -- staff 행
 'dup_rows', (select coalesce(json_agg(json_build_object('id',id,'name',name,'active',active,'user_id',user_id,'clinic_id',clinic_id)),'[]'::json) from staff where id='${DUP}'),
 'canon_rows',(select coalesce(json_agg(json_build_object('id',id,'name',name,'active',active,'user_id',user_id,'clinic_id',clinic_id)),'[]'::json) from staff where id='${CANON}'),
 'by_name',  (select coalesce(json_agg(json_build_object('id',id,'active',active,'user_id',user_id)),'[]'::json) from staff where name like '박소예%'),
 -- (b) per-column freeze: DUP inbound 4컬럼 건수 + id셋
 'dup_ref_duty',      (select count(*) from duty_roster where doctor_id='${DUP}'),
 'dup_ref_duty_ids',  (select coalesce(json_agg(id order by id),'[]'::json) from duty_roster where doctor_id='${DUP}'),
 'dup_ref_pkg',       (select count(*) from package_sessions where performed_by='${DUP}'),
 'dup_ref_pkg_ids',   (select coalesce(json_agg(id order by id),'[]'::json) from package_sessions where performed_by='${DUP}'),
 'dup_ref_room',      (select count(*) from room_assignments where staff_id='${DUP}'),
 'dup_ref_room_ids',  (select coalesce(json_agg(id order by id),'[]'::json) from room_assignments where staff_id='${DUP}'),
 -- (a) customers PHI freeze: DUP 귀속 환자 id셋
 'dup_ref_cust',      (select count(*) from customers where assigned_staff_id='${DUP}'),
 'dup_ref_cust_ids',  (select coalesce(json_agg(id order by id),'[]'::json) from customers where assigned_staff_id='${DUP}'),
 -- CANON 기존 refs (merge-aware · orphan leak 대조 기준선)
 'canon_ref_duty',    (select count(*) from duty_roster where doctor_id='${CANON}'),
 'canon_ref_pkg',     (select count(*) from package_sessions where performed_by='${CANON}'),
 'canon_ref_room',    (select count(*) from room_assignments where staff_id='${CANON}'),
 'canon_ref_cust',    (select count(*) from customers where assigned_staff_id='${CANON}'),
 'canon_ref_cust_ids',(select coalesce(json_agg(id order by id),'[]'::json) from customers where assigned_staff_id='${CANON}'),
 -- (c) unique collision pre-scan: duty_roster UNIQUE(clinic_id,date,doctor_id) — DUP∩CANON (clinic_id,date) 교집합
 'duty_collision', (select coalesce(json_agg(json_build_object('clinic_id',d.clinic_id,'date',d.date)),'[]'::json)
                     from (select clinic_id,date from duty_roster where doctor_id='${DUP}'
                           intersect
                           select clinic_id,date from duty_roster where doctor_id='${CANON}') d),
 -- (e) orphan 은닉: DUP user_id 키를 참조하는 곳 (DUP.user_id=null 이면 무의미이나 확증)
 'dup_user_id',(select user_id from staff where id='${DUP}'),
 -- 활성화 authorizing evidence: CANON user_id 의 user_profiles.active
 'canon_up', (select coalesce(json_agg(json_build_object('id',id,'active',active)),'[]'::json) from user_profiles where id='${CANON_USER}')
) as snap;`;

const s=(await sql(q))[0].snap;
console.log('── #1 박소예 FRESH SNAPSHOT (execution-time) ──');
console.log(JSON.stringify(s,null,2));

const dup=s.dup_rows, canon=s.canon_rows;
const perCol={duty_roster:Number(s.dup_ref_duty),package_sessions:Number(s.dup_ref_pkg),room_assignments:Number(s.dup_ref_room),customers:Number(s.dup_ref_cust)};
const inboundTotal=perCol.duty_roster+perCol.package_sessions+perCol.room_assignments+perCol.customers;

// ── 가드 검증 ──
const checks=[];
checks.push(['DUP 5c17e4bc 정확히 1행', dup.length===1]);
checks.push(['DUP active=TRUE (폐기대상=활성행, #6과 反轉)', dup.length===1 && dup[0].active===true]);
checks.push(['DUP user_id=null', dup.length===1 && dup[0].user_id===null]);
checks.push(['CANON 5fb3e3b1 정확히 1행', canon.length===1]);
checks.push(['CANON active=false (활성화 대상)', canon.length===1 && canon[0].active===false]);
checks.push(['CANON user_id 유지치=833c7135', canon.length===1 && canon[0].user_id===CANON_USER]);
checks.push(['박소예 총 2행 (동명이인 없음)', s.by_name.length===2]);
// (d) clinic parity
checks.push(['(d) clinic_id parity DUP==CANON', dup.length===1&&canon.length===1&&dup[0].clinic_id===canon[0].clinic_id]);
// (c) unique collision pre-scan
checks.push(['(c) duty_roster (clinic_id,date) 충돌 0건', (s.duty_collision||[]).length===0]);
// (e) orphan 은닉 부재: DUP user_id=null → user_id-domain 잔여 참조 없음
checks.push(['(e) DUP user_id=null (user_id-domain 참조 은닉 부재)', s.dup_user_id===null]);
// 활성화 authorizing evidence
const up=s.canon_up||[];
checks.push(['CANON user_profiles.active=true (활성화 근거)', up.length===1 && up[0].active===true]);
// FLAG-3 기대치 대비 참고(비게이트): 07-02 기대 total=12
checks.push(['[참고·비게이트] inbound total=12(07-02 기대)', inboundTotal===12]);

console.log('\n── 가드 검증 ──');
let allPass=true;
for(const [name,ok] of checks){const gate=!/\[참고·비게이트\]/.test(name);console.log(`  ${ok?'✅':(gate?'🔴':'⚠')} ${name}`);if(!ok&&gate)allPass=false;}

// FREEZE MANIFEST — apply DO block 이 컬럼별 UPDATE rowcount 를 이 값과 대사
const manifest={
  generated_at:new Date().toISOString(),
  dup:DUP, canon:CANON, canon_user:CANON_USER,
  clinic_id: dup.length===1?dup[0].clinic_id:null,
  per_column_freeze: perCol,           // ← apply 시 컬럼별 rowcount 이 값과 정확히 일치해야
  inbound_total: inboundTotal,
  dup_customer_ids: s.dup_ref_cust_ids,   // (a) PHI freeze
  canon_customer_ids_before: s.canon_ref_cust_ids,
  dup_duty_ids: s.dup_ref_duty_ids,
  dup_pkg_ids: s.dup_ref_pkg_ids,
  dup_room_ids: s.dup_ref_room_ids,
  canon_refs_before:{duty_roster:Number(s.canon_ref_duty),package_sessions:Number(s.canon_ref_pkg),room_assignments:Number(s.canon_ref_room),customers:Number(s.canon_ref_cust)},
  duty_collision: s.duty_collision,
  all_guards_pass: allPass,
  next: allPass?'GO — apply DO block (freeze 매니페스트 대사)':'ABORT — supervisor 재게이트',
};
console.log('\n── FREEZE MANIFEST ──');
console.log(JSON.stringify(manifest,null,2));

const outPath='scripts/T-20260701-foot-STAFF-ROSTER-DEDUP_1_fresh_snapshot.out.json';
fs.writeFileSync(outPath,JSON.stringify({snapshot:s,manifest},null,2));
console.log('\n→ '+outPath);
if(!allPass){console.error('\n🔴 DRIFT/COLLISION DETECTED — apply 금지, ABORT');process.exit(2);}
console.log('\n✅ 모든 게이트 가드 통과 — apply 진행 가능 (freeze 매니페스트 확정)');
