/**
 * T-20260630-foot-COMPANION-RESV-INSERT-FAIL — AC-3 착수 선결 dependency-sweep 3종 (read-only)
 * DA 지정 (DA-20260630-FOOT-COMPANION-EXTID-TEXT): external_id UUID→TEXT 전 비파괴 확인.
 *   ① UNIQUE (source_system, external_id) WHERE NOT NULL 인덱스 실재 → 재빌드 동반 대상
 *   ② external_id 를 UUID FK 로 참조하는 객체 부재
 *   ③ external_id::uuid 캐스팅 view/fn/generated-col/CHECK 부재
 * Supabase Management API (read-only SELECT/catalog). prod rxlomoozakkjesdqjtvd.
 */
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const TOKEN = env.SUPABASE_ACCESS_TOKEN;
const REF = 'rxlomoozakkjesdqjtvd';

async function q(label, query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await res.json();
  console.log(`\n${label}:`);
  console.log(JSON.stringify(body, null, 2));
  return body;
}

console.log('=== dependency-sweep prod', REF, '(read-only) ===');

await q('[0] reservations external_id/companion 컬럼 타입', `
  SELECT column_name, data_type, udt_name, is_nullable
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='reservations'
    AND column_name IN ('external_id','source_system','customer_real_name','customer_real_phone','customer_id','customer_name')
  ORDER BY column_name;`);

await q('[①] external_id 관련 인덱스 (재빌드 동반 대상)', `
  SELECT indexname, indexdef
  FROM pg_indexes
  WHERE schemaname='public' AND tablename='reservations' AND indexdef ILIKE '%external_id%';`);

await q('[②] reservations.external_id 참조 FK (부재 예상)', `
  SELECT con.conname, src.relname AS referencing_table, att.attname AS referencing_col
  FROM pg_constraint con
  JOIN pg_class tgt ON tgt.oid = con.confrelid
  JOIN pg_class src ON src.oid = con.conrelid
  JOIN unnest(con.confkey) WITH ORDINALITY AS ck(attnum, ord) ON true
  JOIN pg_attribute tatt ON tatt.attrelid = con.confrelid AND tatt.attnum = ck.attnum
  JOIN unnest(con.conkey) WITH ORDINALITY AS fk(attnum, ord2) ON fk.ord2 = ck.ord
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = fk.attnum
  WHERE con.contype='f' AND tgt.relname='reservations' AND tatt.attname='external_id';`);

await q('[③-a] external_id 참조 함수/RPC (uuid 캐스팅 점검)', `
  SELECT p.proname,
         (pg_get_functiondef(p.oid) ILIKE '%external_id::uuid%') AS casts_uuid,
         (pg_get_functiondef(p.oid) ILIKE '%external_id%')        AS refs_external_id
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public'
    AND pg_get_functiondef(p.oid) ILIKE '%reservations%'
    AND pg_get_functiondef(p.oid) ILIKE '%external_id%'
  ORDER BY p.proname;`);

await q('[③-b] external_id 참조 view (uuid 캐스팅 점검)', `
  SELECT viewname,
         (definition ILIKE '%external_id::uuid%') AS casts_uuid
  FROM pg_views WHERE schemaname='public' AND definition ILIKE '%external_id%' ORDER BY viewname;`);

await q('[③-c] external_id 참조 generated column (부재 예상)', `
  SELECT table_name, column_name, generation_expression
  FROM information_schema.columns
  WHERE table_schema='public' AND is_generated='ALWAYS' AND generation_expression ILIKE '%external_id%';`);

await q('[③-d] external_id 참조 CHECK 제약 (부재 예상)', `
  SELECT con.conname, rel.relname AS table_name, pg_get_constraintdef(con.oid) AS def
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = rel.relnamespace
  WHERE n.nspname='public' AND con.contype='c' AND pg_get_constraintdef(con.oid) ILIKE '%external_id%';`);

await q('[데이터] external_id non-null 분포 (무손실 widening 확인)', `
  SELECT count(*) FILTER (WHERE external_id IS NOT NULL) AS non_null_extid,
         count(*) FILTER (WHERE customer_id IS NULL)     AS customer_id_null,
         count(*) AS total
  FROM public.reservations;`);

console.log('\n=== sweep 완료 ===');
