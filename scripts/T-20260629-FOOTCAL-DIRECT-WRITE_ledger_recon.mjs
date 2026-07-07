/**
 * T-20260629-dopamine-FOOTCAL-DIRECT-WRITE — Migration Ledger Reconciliation (read-only).
 * schema_migrations 원장 ↔ 파일 ↔ prod 함수 실재 3자 대조.
 * 190000/193000 적용 여부 + upsert_reservation_from_source 현재 signature/body(guard#5) 확인.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dir = dirname(fileURLToPath(import.meta.url));
const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const env = Object.fromEntries(
  readFileSync(join(__dir, '../.env.local'), 'utf8').split('\n').filter(l => l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN required');

async function q(sql) {
  const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query: sql }) });
  const body = await resp.json();
  if (!resp.ok) { console.error('❌ query failed:', JSON.stringify(body, null, 2)); process.exit(1); }
  return body;
}

console.log('══ Migration Ledger Reconciliation — FOOTCAL-DIRECT-WRITE ══\n');

// 1) schema_migrations 원장 — 190000/193000 존재 여부
console.log('── 1) schema_migrations ledger (190000/193000 근처) ──');
const led = await q(`SELECT version, name FROM supabase_migrations.schema_migrations
  WHERE version IN ('20260630190000','20260630193000')
     OR version LIKE '2026063019%' ORDER BY version;`);
console.log(JSON.stringify(led, null, 2));

// 2) prod 함수 실재 — upsert_reservation_from_source 모든 오버로드 signature
console.log('\n── 2) prod 함수 signature(들) ──');
const sigs = await q(`SELECT p.oid::regprocedure::text AS signature, pg_get_function_arguments(p.oid) AS args
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='upsert_reservation_from_source' ORDER BY 1;`);
console.log(JSON.stringify(sigs, null, 2));

// 3) 함수 body 특징 플래그 — guard#5(lifecycle-invalid), 17-arg 특징, customer_real_name 처리
console.log('\n── 3) 함수 body 특징 플래그 ──');
const flags = await q(`SELECT
    bool_or(def ILIKE '%lifecycle-invalid%') AS has_guard5,
    bool_or(def ILIKE '%c_inflight_terminal%') AS has_inflight_arr,
    bool_or(def ILIKE '%p_is_companion%') AS has_companion_arg,
    bool_or(def ILIKE '%customer_real_name%') AS has_real_name,
    count(*) AS overloads
  FROM (SELECT pg_get_functiondef(p.oid) AS def
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='upsert_reservation_from_source') t;`);
console.log(JSON.stringify(flags, null, 2));

// 4) reservations.external_id 타입 + UNIQUE 인덱스 실재 (190000 DDL 착지 확인)
console.log('\n── 4) reservations.external_id 타입 + UNIQUE 인덱스 ──');
const col = await q(`SELECT data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='reservations' AND column_name='external_id';`);
console.log('external_id type:', JSON.stringify(col.result?.[0] ?? col));
const idx = await q(`SELECT indexname, indexdef FROM pg_indexes
  WHERE schemaname='public' AND tablename='reservations' AND indexname='idx_reservations_source_external';`);
console.log('unique index:', JSON.stringify(idx.result?.[0] ?? idx));

// 5) customer_real_name 컬럼 실재
console.log('\n── 5) reservations.customer_real_name 컬럼 실재 ──');
const crn = await q(`SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='reservations' AND column_name='customer_real_name';`);
console.log(JSON.stringify(crn.result ?? crn));

console.log('\n══ 완료 — 위 결과로 forward 적용 대상 판정 ══');
