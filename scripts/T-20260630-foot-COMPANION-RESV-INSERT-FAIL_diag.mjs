/**
 * T-20260630-foot-COMPANION-RESV-INSERT-FAIL — AC-1 격리 read-only 진단
 * 동행 INSERT 실패 경계 특정. 비파괴(SELECT/메타 only). prod rxlomoozakkjesdqjtvd.
 *   - reservations.customer_id nullable 여부 (23502 후보)
 *   - reservations.customer_real_name 컬럼 존재 여부 (§4-2b v2.1 동행 스냅샷)
 *   - upsert_reservation_from_source 함수 시그니처 (동행 인자 p_is_companion/p_customer_real_name 유무)
 *   - customer_id IS NULL 예약 / +821000000000 더미폰 customer 실재 여부
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });

async function rpcSql(sql) {
  // service_role 임의 SQL 실행용 헬퍼 RPC가 있으면 사용, 없으면 null 반환(메타는 information_schema REST로 폴백)
  try {
    const { data, error } = await sb.rpc('exec_sql', { sql });
    return { data, error };
  } catch (e) {
    return { data: null, error: { message: String(e?.message ?? e) } };
  }
}

console.log('=== prod', url, '===\n');

// 1) reservations 컬럼 메타 (information_schema via PostgREST 직접 접근 불가 → pg_catalog RPC 시도, 폴백=실데이터 추론)
const meta = await rpcSql(`
  SELECT column_name, is_nullable, data_type
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='reservations'
    AND column_name IN ('customer_id','customer_real_name','customer_name','customer_phone','source_system','external_id')
  ORDER BY column_name;`);
console.log('[1] reservations 컬럼 메타:', meta.error ? `(exec_sql 불가: ${meta.error.message})` : '');
if (meta.data) console.table(meta.data);

// 2) 함수 시그니처
const fn = await rpcSql(`
  SELECT proname, pg_get_function_identity_arguments(oid) AS args
  FROM pg_proc WHERE proname='upsert_reservation_from_source';`);
console.log('\n[2] upsert_reservation_from_source 시그니처:', fn.error ? `(exec_sql 불가: ${fn.error.message})` : '');
if (fn.data) console.table(fn.data);

// 3) customer_real_name 컬럼 실재 — SELECT 시도(컬럼 없으면 에러코드로 판별)
const crn = await sb.from('reservations').select('id, customer_real_name').limit(1);
console.log('\n[3] reservations.customer_real_name SELECT:',
  crn.error ? `❌ 부재/에러: ${crn.error.code ?? ''} ${crn.error.message}` : `✅ 존재 (sample rows=${crn.data?.length ?? 0})`);

// 4) customer_id IS NULL 예약(=동행 후보) 개수
const nullCust = await sb.from('reservations').select('id', { count: 'exact', head: true }).is('customer_id', null);
console.log('\n[4] customer_id IS NULL 예약 수:', nullCust.error ? `에러 ${nullCust.error.message}` : (nullCust.count ?? 0));

// 5) 더미폰 customer 실재(+821000000000 / 01000000000)
for (const ph of ['+821000000000', '01000000000', '821000000000']) {
  const r = await sb.from('customers').select('id', { count: 'exact', head: true }).eq('phone', ph);
  console.log(`[5] customers.phone='${ph}' 수:`, r.error ? `에러 ${r.error.message}` : (r.count ?? 0));
}

// 6) 최근 dopamine 인입 예약 표본(이름/폰/customer_id) — 동행 미반영 패턴 확인
const recent = await sb.from('reservations')
  .select('id, customer_name, customer_phone, customer_id, source_system, external_id, reservation_date, created_at')
  .eq('source_system', 'dopamine')
  .order('created_at', { ascending: false })
  .limit(10);
console.log('\n[6] 최근 dopamine 인입 예약 10건:', recent.error ? `에러 ${recent.error.message}` : '');
if (recent.data) console.table(recent.data.map((r) => ({
  name: r.customer_name, phone: r.customer_phone, cust_id: r.customer_id ? 'set' : 'NULL',
  ext: (r.external_id ?? '').slice(0, 28), date: r.reservation_date,
})));
