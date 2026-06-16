// T-20260616-foot-CALLLIST-(MANUALORDER|REORDER)-SAVE-FAIL — ADDITIVE 마이그 prod 적용
// 분기 (A): WS-C 마이그 20260616000000 prod 미적용 → ADD COLUMN IF NOT EXISTS 보충.
// 게이트: DA CONSULT GO (MSG-20260615-192219-rbcg, ADDITIVE/blast radius 0) + DDL-diff(순수 additive/idempotent) → 대표게이트 면제.
// 멱등: ADD COLUMN IF NOT EXISTS → 재실행 안전. 데이터 변경 0, NULL default, backward-compatible.
import pg from 'pg'; import { readFileSync } from 'node:fs';
let P=process.env.SUPABASE_DB_PASSWORD;
for(const l of readFileSync(process.env.HOME+'/Documents/GitHub/obliv-foot-crm/.env','utf8').split('\n')){const m=l.match(/^SUPABASE_DB_PASSWORD=(.*)$/);if(m)P=m[1].trim();}
const c=new pg.Client({host:'aws-1-ap-southeast-1.pooler.supabase.com',port:5432,database:'postgres',user:'postgres.rxlomoozakkjesdqjtvd',password:P,ssl:{rejectUnauthorized:false}});
await c.connect();

const colQ=`SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns
            WHERE table_name='check_ins' AND column_name='call_list_manual_order'`;

console.log('=== PRE: 컬럼 실재 여부 ===');
let {rows:pre}=await c.query(colQ);
console.log(pre.length===0 ? '  컬럼 부재(적용 필요)' : '  이미 존재: '+JSON.stringify(pre[0]));

console.log('\n=== APPLY: ADDITIVE 마이그 (idempotent) ===');
await c.query(`ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS call_list_manual_order integer NULL`);
await c.query(`COMMENT ON COLUMN check_ins.call_list_manual_order IS 'T-20260615-foot WS-C 진료콜 명단 수기 순서 override. NULL=자동 진입순, 값(asc)=수기 우선순위. 당일 check_in 행 단위(다음날 새 행에서 자연 소멸).'`);
console.log('  ALTER + COMMENT 실행 완료');

console.log('\n=== POST: 검증 ===');
let {rows:post}=await c.query(colQ);
if(post.length===1){
  console.log('  ✅ 컬럼 존재 확정:', JSON.stringify(post[0]));
} else {
  console.log('  ❌ 적용 실패 — 컬럼 여전히 부재'); process.exit(2);
}

console.log('\n=== RC#2 보조: check_ins UPDATE RLS 정책 (pg_policy.polcmd) ===');
const {rows:rls}=await c.query(
  `SELECT polname, polcmd::text AS cmd, polroles::text AS roles
   FROM pg_policy pol JOIN pg_class cl ON pol.polrelid=cl.oid
   WHERE cl.relname='check_ins' ORDER BY polname`);
const {rows:rlsOn}=await c.query(`SELECT relrowsecurity FROM pg_class WHERE relname='check_ins'`);
console.log('  check_ins RLS enabled:', rlsOn[0]?.relrowsecurity, '| 정책수:', rls.length);
for(const r of rls){ console.log(`  - ${r.polname} [cmd=${r.cmd}]`); }

await c.end();
console.log('\nDONE');
