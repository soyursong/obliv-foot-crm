/** T-20260629-foot-ANON-PII-LEAK Phase 1 — APPLY (REVOKE) + before/after 검증 */
import pg from 'pg'; import fs from 'fs';
const { Client } = pg;
let P=process.env.SUPABASE_DB_PASSWORD;
if(!P&&fs.existsSync('.env'))for(const l of fs.readFileSync('.env','utf8').split('\n')){const m=l.match(/^SUPABASE_DB_PASSWORD=(.*)$/);if(m)P=m[1].trim();}
const conn=()=>new Client({host:'aws-1-ap-southeast-1.pooler.supabase.com',port:5432,database:'postgres',user:'postgres.rxlomoozakkjesdqjtvd',password:P,ssl:{rejectUnauthorized:false}});
const Q=`SELECT table_name, string_agg(privilege_type,',' ORDER BY privilege_type) AS privs
  FROM information_schema.role_table_grants WHERE grantee='anon' AND table_schema='public'
  AND table_name IN ('customers','check_ins','reservations','staff','user_profiles') GROUP BY table_name ORDER BY table_name`;
const sql=fs.readFileSync('supabase/migrations/20260629140000_anon_pii_leak_revoke_phase1.sql','utf8');
const c=conn(); await c.connect();
console.log('연결 OK', new Date().toISOString());
console.log('\n── BEFORE anon grants ──');
for(const r of (await c.query(Q)).rows) console.log(`  ${r.table_name}: ${r.privs}`);
await c.query(sql);
console.log('\n✅ Phase 1 REVOKE 적용 (COMMIT)');
await c.end();
const c2=conn(); await c2.connect();
console.log('\n── AFTER anon grants (신규 연결, 영속 확인) ──');
for(const r of (await c2.query(Q)).rows) console.log(`  ${r.table_name}: ${r.privs}`);
// 회귀가드: 셀프체크인 필수 권한 보존 확인
const after=Object.fromEntries((await c2.query(Q)).rows.map(r=>[r.table_name,r.privs]));
const must=(t,p)=>{const ok=(after[t]||'').split(',').includes(p);console.log(`  ${ok?'✅':'❌'} ${t} retains ${p}`);return ok;};
const gone=(t,p)=>{const ok=!(after[t]||'').split(',').includes(p);console.log(`  ${ok?'✅':'❌'} ${t} dropped ${p}`);return ok;};
console.log('\n── 회귀가드 ──');
let pass=true;
[['customers','SELECT'],['customers','INSERT'],['customers','UPDATE'],
 ['check_ins','SELECT'],['check_ins','INSERT'],['check_ins','UPDATE'],
 ['reservations','SELECT'],['reservations','UPDATE']].forEach(([t,p])=>{pass=must(t,p)&&pass;});
[['customers','DELETE'],['check_ins','DELETE'],['reservations','INSERT'],['reservations','DELETE']].forEach(([t,p])=>{pass=gone(t,p)&&pass;});
console.log(`  ${(after['staff']==null||after['staff']==='')?'✅':'❌'} staff anon grants cleared (${after['staff']||'none'})`);
console.log(`  ${(after['user_profiles']==null||after['user_profiles']==='')?'✅':'❌'} user_profiles anon grants cleared (${after['user_profiles']||'none'})`);
pass = pass && (after['staff']==null) && (after['user_profiles']==null);
await c2.end();
console.log(pass?'\n✅✅ Phase 1 PASS':'\n❌ Phase 1 회귀가드 실패'); process.exit(pass?0:1);
