/**
 * T-20260625-foot-FOREIGN-HEALTHQ-EN — DB 상태 진단 (read-only)
 *   health_q_tokens.lang 컬럼 존재 / CHECK 제약 / RPC 정의 / form_data 키사전 COMMENT 확인
 * 실행: node scripts/T-20260625-foot-FOREIGN-HEALTHQ-EN_probe.mjs
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) DB_PASSWORD = m[1].trim();
  }
}
if (!DB_PASSWORD) { console.error('❌ SUPABASE_DB_PASSWORD 필요'); process.exit(1); }

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

await client.connect();

const col = await client.query(`
  SELECT column_name, data_type, column_default, is_nullable
  FROM information_schema.columns
  WHERE table_name='health_q_tokens' AND column_name='lang';`);
console.log('=== health_q_tokens.lang column ===');
console.log(col.rows.length ? col.rows : '(NOT PRESENT)');

const chk = await client.query(`
  SELECT conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
  WHERE conrelid='health_q_tokens'::regclass AND contype='c';`);
console.log('=== health_q_tokens CHECK constraints ===');
console.log(chk.rows.length ? chk.rows : '(none)');

const fns = await client.query(`
  SELECT p.proname, pg_get_function_arguments(p.oid) AS args
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE p.proname IN ('fn_health_q_create_token','fn_health_q_validate_token','fn_health_q_submit')
  ORDER BY p.proname;`);
console.log('=== RPC functions ===');
console.log(fns.rows);

// create_token / validate_token 내부에 lang 반영됐는지
const src = await client.query(`
  SELECT p.proname, (pg_get_functiondef(p.oid) ILIKE '%lang%') AS has_lang
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE p.proname IN ('fn_health_q_create_token','fn_health_q_validate_token');`);
console.log('=== RPC has lang? ===');
console.log(src.rows);

const cmt = await client.query(`SELECT obj_description('health_q_results'::regclass) AS comment;`);
console.log('=== health_q_results COMMENT ===');
console.log(cmt.rows[0]?.comment?.slice(0, 400) ?? '(none)');

await client.end();
