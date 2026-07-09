/**
 * T-20260702-foot-FOREIGN-SELFREG-FLOW-CONSENT-SPEC — STAGE1 실측 (READ-ONLY)
 * DDL/write 없음. exec_sql_readonly = SELECT only + PostgREST 폴백.
 *  ① customers.phone_dummy 컬럼 prod 실재 (schema_registry 선언 != prod 실재)
 *  ③ customers phone='' 행 수 (지점별)  ④ DUMMY- 토큰 유무 + check_in_id 키소스
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
let KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY && fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local','utf8').split('\n')) {
    const m = line.match(/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/);
    if (m) KEY = m[1].trim();
  }
}
if (!KEY) { console.error('❌ SERVICE_ROLE_KEY 필요'); process.exit(1); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

let RPC_OK = true;
async function sql(label, q) {
  const { data, error } = await sb.rpc('exec_sql_readonly', { q })
    .then(r => r, e => ({ data: null, error: e }));
  if (error) {
    RPC_OK = false;
    console.log(`\n### ${label}\n  exec_sql_readonly ERROR: ${error.message}`);
    return null;
  }
  console.log(`\n### ${label}`);
  console.log(JSON.stringify(data, null, 2));
  return data;
}

// ── RPC 경로 (있으면 권위적) ──
await sql('① customers phone/phone_dummy 컬럼 실재 (information_schema)', `
  select column_name, data_type, is_nullable, column_default
  from information_schema.columns
  where table_schema='public' and table_name='customers'
    and (column_name ilike '%phone%' or column_name ilike '%dummy%' or column_name ilike '%placeholder%')
  order by column_name`);

await sql('② phone 관련 제약 (UNIQUE/NOT NULL)', `
  select con.conname, pg_get_constraintdef(con.oid) as def
  from pg_constraint con join pg_class c on c.oid=con.conrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='customers'
    and pg_get_constraintdef(con.oid) ilike '%phone%'`);

await sql('③ phone="" 행 수 + 지점별', `
  select coalesce(clinic_id::text,'(null)') as clinic_id, count(*)::int as empty_phone_rows
  from customers where phone='' group by clinic_id order by empty_phone_rows desc`);

await sql('③-c phone IS NULL 행 수', `select count(*)::int as null_phone_rows from customers where phone is null`);

await sql('④ 기존 DUMMY-% 토큰 유무', `
  select count(*)::int as dummy_rows, count(distinct phone)::int as distinct_tokens
  from customers where phone like 'DUMMY-%'`);

await sql('④-b check_ins.id 타입 (토큰키 소스 후보)', `
  select column_name, data_type, column_default from information_schema.columns
  where table_schema='public' and table_name='check_ins' and column_name='id'`);

// ── PostgREST 폴백 (RPC 없거나 실패 시 최소 확정) ──
console.log('\n\n========== PostgREST 직접 프로브 (교차검증/폴백) ==========');

// ①' phone_dummy 컬럼 존재: select 시도 → 42703 이면 부재
{
  const probe = await sb.from('customers').select('id,phone_dummy').limit(1);
  console.log(`\n[①' phone_dummy 컬럼]  ${probe.error ? 'ERROR: '+probe.error.message+' (code='+probe.error.code+')' : 'OK — 컬럼 존재 (sample='+JSON.stringify(probe.data)+')'}`);
}
// phone 컬럼 존재 sanity
{
  const probe = await sb.from('customers').select('id,phone').limit(1);
  console.log(`[phone 컬럼 sanity]  ${probe.error ? 'ERROR: '+probe.error.message : 'OK'}`);
}
// ③' phone='' count (head+exact)
{
  const { count, error } = await sb.from('customers').select('*', { count:'exact', head:true }).eq('phone','');
  console.log(`[③' phone='' 행 수]  ${error ? 'ERROR: '+error.message : count}`);
}
// phone is null count
{
  const { count, error } = await sb.from('customers').select('*', { count:'exact', head:true }).is('phone', null);
  console.log(`[phone IS NULL 행 수]  ${error ? 'ERROR: '+error.message : count}`);
}
// DUMMY-% count
{
  const { count, error } = await sb.from('customers').select('*', { count:'exact', head:true }).like('phone','DUMMY-%');
  console.log(`[④' phone LIKE DUMMY-% 행 수]  ${error ? 'ERROR: '+error.message : count}`);
}
// customers 총 행 수 (맥락)
{
  const { count, error } = await sb.from('customers').select('*', { count:'exact', head:true });
  console.log(`[customers 총 행 수]  ${error ? 'ERROR: '+error.message : count}`);
}
// phone='' 지점별 (폴백: 데이터 fetch 후 group) — 소량 가정
{
  const { data, error } = await sb.from('customers').select('clinic_id').eq('phone','');
  if (error) console.log(`[③' 지점별 폴백]  ERROR: ${error.message}`);
  else {
    const m = {}; for (const r of data) m[r.clinic_id ?? '(null)'] = (m[r.clinic_id ?? '(null)']||0)+1;
    console.log(`[③' phone='' 지점별]  ${JSON.stringify(m)}`);
  }
}

console.log(`\n=== STAGE1 완료 (READ-ONLY). RPC 경로 ${RPC_OK?'성공':'실패→PostgREST 프로브 기준'} ===`);
