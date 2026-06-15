import pg from 'pg'; import { readFileSync } from 'node:fs';
let P=process.env.SUPABASE_DB_PASSWORD;
for(const l of readFileSync(process.env.HOME+'/Documents/GitHub/obliv-foot-crm/.env','utf8').split('\n')){const m=l.match(/^SUPABASE_DB_PASSWORD=(.*)$/);if(m)P=m[1].trim();}
const c=new pg.Client({host:'aws-1-ap-southeast-1.pooler.supabase.com',port:5432,database:'postgres',user:'postgres.rxlomoozakkjesdqjtvd',password:P,ssl:{rejectUnauthorized:false}});
await c.connect();
const tbls=['redpay_raw_transactions','payment_reconciliation_log','redpay_poller_state'];
console.log('=== #3 신규 3테이블 존재 ===');
for(const t of tbls){const{rows}=await c.query(`SELECT to_regclass($1) reg`,[`public.${t}`]);console.log(`  ${rows[0].reg?'✅ 이미 있음':'❌ 없음(신규대상)'} ${t}`);}
console.log('=== payments 6 신규컬럼 존재여부 ===');
const cols=['external_approval_no','external_tid','reconciliation_status','reconciled_at','redpay_tid','cancelled_at'];
const{rows}=await c.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name=ANY($1)`,[cols]);
const have=new Set(rows.map(r=>r.column_name));
for(const col of cols)console.log(`  ${have.has(col)?'✅ 있음':'❌ 없음(ADD대상)'} ${col}`);
await c.end();
