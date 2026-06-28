/**
 * T-20260627-foot-ANON-RLS-PHASE2B — prod apply (supervisor FIX-REQUEST MSG-20260629-031949-mheq)
 * supervisor DDL-diff GO (ticket line 187~193). 적용 순서:
 *   1) 20260629120000_foot_consent_sensitive   (consent_sensitive 3컬럼 + 13-arg RPC)
 *   2) 20260628160000_anon_upsert_customer_resolve_v2  (ADDITIVE SECDEF 12-arg)
 *   3) 20260629160000_anon_upsert_customer_resolve_v3  (ADDITIVE SECDEF 15-arg, 컬럼 guard RAISE 전제)
 * 모든 마이그 ADDITIVE/ZERO-REGRESSION. 각 파일 자체 BEGIN/COMMIT 트랜잭션.
 */
import pg from 'pg'; import fs from 'fs';
const { Client } = pg;
let P=process.env.SUPABASE_DB_PASSWORD;
if(!P&&fs.existsSync('.env'))for(const l of fs.readFileSync('.env','utf8').split('\n')){const m=l.match(/^SUPABASE_DB_PASSWORD=(.*)$/);if(m)P=m[1].trim();}
const conn=()=>new Client({host:'aws-1-ap-southeast-1.pooler.supabase.com',port:5432,database:'postgres',user:'postgres.rxlomoozakkjesdqjtvd',password:P,ssl:{rejectUnauthorized:false}});

const COLQ=`SELECT column_name,data_type,column_default,is_nullable FROM information_schema.columns WHERE table_name='customers' AND column_name IN ('consent_sensitive','consent_agreed_at','consent_version') ORDER BY column_name`;
const FNQ=`SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
  array_to_string(p.proacl,' ') AS acl, p.prosecdef
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN
  ('fn_selfcheckin_update_personal_info','fn_selfcheckin_rrn_match','fn_selfcheckin_upsert_customer',
   'fn_selfcheckin_upsert_customer_resolve_v2','fn_selfcheckin_upsert_customer_resolve_v3')
  ORDER BY p.proname, args`;
const showCols=async c=>{const r=await c.query(COLQ);console.log(r.rows.length?r.rows.map(x=>`    ${x.column_name} ${x.data_type} default=${x.column_default} null=${x.is_nullable}`).join('\n'):'    (없음)');};
const showFns=async c=>{const r=await c.query(FNQ);for(const x of r.rows)console.log(`    ${x.proname}(${x.args}) secdef=${x.prosecdef} acl=${x.acl||'∅'}`);if(!r.rows.length)console.log('    (없음)');};

const FILES=[
  ['1) consent_sensitive','/tmp/m1_consent_sensitive.sql'],
  ['2) resolve_v2','/tmp/m2_resolve_v2.sql'],
  ['3) resolve_v3','/tmp/m3_resolve_v3.sql'],
];

const c=conn(); await c.connect();
console.log('연결 OK', new Date().toISOString());
console.log('\n════ BEFORE ════');
console.log('  [consent 컬럼]'); await showCols(c);
console.log('  [함수]'); await showFns(c);

for(const [label,path] of FILES){
  const sql=fs.readFileSync(path,'utf8');
  console.log(`\n──── APPLY ${label} (${path}) ────`);
  try{
    await c.query(sql);
    console.log(`  ✅ ${label} 적용 완료 (COMMIT)`);
  }catch(e){
    console.error(`  ❌ ${label} 실패:`, e.message);
    await c.end(); process.exit(1);
  }
}
await c.end();

// 신규 연결로 영속 검증
const c2=conn(); await c2.connect();
console.log('\n════ AFTER (신규 연결, 영속 확인) ════');
console.log('  [consent 컬럼]'); await showCols(c2);
console.log('  [함수]'); await showFns(c2);

// PASS 게이트
const cols=(await c2.query(COLQ)).rows.map(r=>r.column_name);
const fns=(await c2.query(FNQ)).rows;
const has=(name,argcnt)=>fns.some(f=>f.proname===name && f.args.split(',').length===argcnt);
const anonExec=name=>fns.some(f=>f.proname===name && (f.acl||'').includes('anon='));
let pass=true;
const chk=(ok,msg)=>{console.log(`  ${ok?'✅':'❌'} ${msg}`);pass=ok&&pass;};
console.log('\n════ PASS 게이트 ════');
chk(cols.length===3,`consent 3컬럼 존재 (${cols.join(',')})`);
chk(has('fn_selfcheckin_update_personal_info',13),'update_personal_info 13-arg');
chk(has('fn_selfcheckin_upsert_customer_resolve_v2',12),'resolve_v2 12-arg');
chk(has('fn_selfcheckin_upsert_customer_resolve_v3',15),'resolve_v3 15-arg');
chk(anonExec('fn_selfcheckin_upsert_customer_resolve_v2'),'resolve_v2 anon EXECUTE grant');
chk(anonExec('fn_selfcheckin_upsert_customer_resolve_v3'),'resolve_v3 anon EXECUTE grant');
await c2.end();
console.log(pass?'\n✅✅ PHASE2B prod apply PASS':'\n❌ 검증 실패'); process.exit(pass?0:1);
