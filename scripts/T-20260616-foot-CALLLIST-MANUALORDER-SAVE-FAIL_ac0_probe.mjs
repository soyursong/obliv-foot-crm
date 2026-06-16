// T-20260616-foot-CALLLIST-MANUALORDER-SAVE-FAIL — AC-0 RC 격리 READ-ONLY probe
// RC#1: prod check_ins.call_list_manual_order 컬럼 실재 여부 (0행이면 마이그 prod 미적용 확정)
// RC#2: 컬럼 있으면 check_ins UPDATE RLS 정책 점검
import pg from 'pg'; import { readFileSync } from 'node:fs';
let P=process.env.SUPABASE_DB_PASSWORD;
for(const l of readFileSync(process.env.HOME+'/Documents/GitHub/obliv-foot-crm/.env','utf8').split('\n')){const m=l.match(/^SUPABASE_DB_PASSWORD=(.*)$/);if(m)P=m[1].trim();}
const c=new pg.Client({host:'aws-1-ap-southeast-1.pooler.supabase.com',port:5432,database:'postgres',user:'postgres.rxlomoozakkjesdqjtvd',password:P,ssl:{rejectUnauthorized:false}});
await c.connect();

console.log('=== RC#1: check_ins.call_list_manual_order 컬럼 실재 여부 (READ-ONLY) ===');
const {rows:col}=await c.query(
  `SELECT column_name,data_type,is_nullable FROM information_schema.columns
   WHERE table_name='check_ins' AND column_name='call_list_manual_order'`);
if(col.length===0){
  console.log('  ❌ 0행 = 컬럼 부재 = 마이그 20260616000000 prod 미적용 = RC#1 확정');
}else{
  console.log('  ✅ 컬럼 존재:', JSON.stringify(col[0]));
}

console.log('\n=== RC#2: check_ins UPDATE RLS 정책 (참고) ===');
const {rows:rls}=await c.query(
  `SELECT polname, cmd, roles::text, qual, with_check
   FROM pg_policy pol JOIN pg_class cl ON pol.polrelid=cl.oid
   WHERE cl.relname='check_ins' ORDER BY polname`);
console.log('  RLS enabled rows:', rls.length);
for(const r of rls){
  console.log(`  - ${r.polname} [${r.cmd}] roles=${r.roles}`);
}
const {rows:rlsOn}=await c.query(`SELECT relrowsecurity FROM pg_class WHERE relname='check_ins'`);
console.log('  check_ins RLS enabled:', rlsOn[0]?.relrowsecurity);

await c.end();
