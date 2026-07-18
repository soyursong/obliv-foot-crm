/**
 * #1 박소예 — READ-ONLY exploration (prod write 0)
 * 라이브 상태 + 스키마 + unique 제약 조사. 어떤 write도 하지 않음.
 */
import fs from 'fs';
function env(k){for(const f of ['.env.local','.env']){if(!fs.existsSync(f))continue;for(const l of fs.readFileSync(f,'utf8').split('\n')){const m=l.match(new RegExp('^'+k+'=(.*)$'));if(m)return m[1].trim().replace(/^"|"$/g,'');}}return process.env[k]||null;}
const TOKEN=env('SUPABASE_ACCESS_TOKEN'), REF='rxlomoozakkjesdqjtvd';
if(!TOKEN){console.error('❌ SUPABASE_ACCESS_TOKEN 없음');process.exit(1);}
const DUP='5c17e4bc', CANON='5fb3e3b1';
async function sql(query){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query})});const t=await r.text();if(r.status>=300)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}

// 1) 박소예 두 행 + 동명이인 전체 (prefix로 full uuid 확정)
const r1=await sql(`select id,name,active,user_id,clinic_id from staff where name like '박소예%' or id::text like '${DUP}%' or id::text like '${CANON}%' order by name,id;`);
console.log('=== 박소예 관련 staff 행 ===');console.log(JSON.stringify(r1,null,2));

// 2) staff 컬럼 (clinic_slug/clinic_id 존재 확인)
const r2=await sql(`select column_name,data_type from information_schema.columns where table_name='staff' and table_schema='public' order by ordinal_position;`);
console.log('\n=== staff 컬럼 ===');console.log(r2.map(c=>c.column_name).join(', '));

// 3) 4 대상 테이블 존재/컬럼 확인
for(const [t,c] of [['duty_roster','doctor_id'],['package_sessions','performed_by'],['room_assignments','staff_id'],['customers','assigned_staff_id']]){
  const rc=await sql(`select count(*) as ok from information_schema.columns where table_schema='public' and table_name='${t}' and column_name='${c}';`);
  console.log(`  ${t}.${c}: ${Number(rc[0].ok)===1?'존재✅':'없음🔴'}`);
}

// 4) unique 제약 (4 테이블) — 충돌 pre-scan 용
const r4=await sql(`select tc.table_name, tc.constraint_name, tc.constraint_type,
  string_agg(kcu.column_name, ',' order by kcu.ordinal_position) as cols
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu on kcu.constraint_name=tc.constraint_name and kcu.table_schema=tc.table_schema
  where tc.table_schema='public' and tc.table_name in ('duty_roster','package_sessions','room_assignments','customers')
    and tc.constraint_type in ('UNIQUE','PRIMARY KEY')
  group by tc.table_name, tc.constraint_name, tc.constraint_type order by tc.table_name;`);
console.log('\n=== 4 테이블 unique/pk 제약 ===');console.log(JSON.stringify(r4,null,2));

// 5) unique indexes (제약 아닌 unique index 포함)
const r5=await sql(`select tablename, indexname, indexdef from pg_indexes where schemaname='public' and tablename in ('duty_roster','package_sessions','room_assignments','customers') and indexdef ilike '%unique%' order by tablename;`);
console.log('\n=== unique indexes ===');console.log(JSON.stringify(r5,null,2));

fs.writeFileSync('scripts/_dedup1_explore.out.json',JSON.stringify({staff_rows:r1,staff_cols:r2.map(c=>c.column_name),constraints:r4,unique_indexes:r5},null,2));
console.log('\n✅ explore done → scripts/_dedup1_explore.out.json');
