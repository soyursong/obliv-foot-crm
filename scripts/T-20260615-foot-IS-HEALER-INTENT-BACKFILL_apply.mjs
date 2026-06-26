// T-20260615-foot-IS-HEALER-INTENT-BACKFILL — AC-3 backfill apply (dev-foot _pg 직접실행)
//   datafix: 20260615T_is_healer_intent_backfill.datafix.sql (멱등 IS DISTINCT FROM 가드)
//   전후 ground-truth(is_healer_intent=true 분포) 검증. 트랜잭션 + 결과 출력.
//   전제: AC-1 gate PASS(컬럼 존재) + AC-2 dry-run CLEAN(probe 선행).
import pg from 'pg'; import { readFileSync } from 'node:fs';
const ROOT=process.env.HOME+'/Documents/GitHub/obliv-foot-crm';
let P=process.env.SUPABASE_DB_PASSWORD;
for(const l of readFileSync(ROOT+'/.env','utf8').split('\n')){const m=l.match(/^SUPABASE_DB_PASSWORD=(.*)$/);if(m)P=m[1].trim();}
const c=new pg.Client({host:'aws-1-ap-southeast-1.pooler.supabase.com',port:5432,database:'postgres',user:'postgres.rxlomoozakkjesdqjtvd',password:P,ssl:{rejectUnauthorized:false}});
await c.connect();

const sql=readFileSync(ROOT+'/supabase/migrations/20260615T_is_healer_intent_backfill.datafix.sql','utf8');

async function dist(label){
  const{rows}=await c.query(
    `SELECT count(*) FILTER (WHERE healer_flag=true) hf_true,
            count(*) FILTER (WHERE is_healer_intent=true) intent_true,
            count(*) FILTER (WHERE healer_flag=true AND is_healer_intent IS DISTINCT FROM true) pending
       FROM public.reservations`);
  const d=rows[0];
  console.log(`[${label}] healer_flag=true:${d.hf_true} / is_healer_intent=true:${d.intent_true} / 승계대기:${d.pending}`);
  return d;
}

console.log('=== AC-3 backfill apply (transaction) ===');
const before=await dist('적용 전');

await c.query('BEGIN');
let updated;
try{
  const res=await c.query(sql);
  updated=res.rowCount;
  console.log(`▶ datafix UPDATE 적용: ${updated} row 변경`);
  await c.query('COMMIT');
  console.log('✅ COMMIT');
}catch(e){
  await c.query('ROLLBACK');
  console.log('❌ ROLLBACK — '+e.message);
  await c.end(); process.exit(1);
}

const after=await dist('적용 후');

// ground-truth 검증: 적용 후 is_healer_intent=true == 적용 전 hf_true (모든 힐러 의도 승계) + 승계대기 0
const ok = Number(after.pending)===0 && Number(after.intent_true) >= Number(before.hf_true);
console.log(ok
  ? `\n✅ GROUND-TRUTH OK — 승계대기 0, is_healer_intent=true ${after.intent_true}건(healer_flag=true ${before.hf_true}건 전부 승계).`
  : `\n❌ GROUND-TRUTH MISMATCH — 승계대기 ${after.pending}, intent_true ${after.intent_true} < hf_true ${before.hf_true}.`);
await c.end();
process.exit(ok?0:1);
