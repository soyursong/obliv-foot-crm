/**
 * T-20260818-foot-CREATEDVIA-BACKFILL-PREMIGRATION — DISCOVERY (READ-ONLY)
 * Phase-0 introspection before the DISPOSITIVE census (STEP 1).
 * GATE: READ-ONLY — SELECT / information_schema / pg_catalog only. prod write/DDL 0.
 * auth: Supabase Management API database/query = postgres superuser (RLS 미적용) → silent 0-row 회피.
 */
const REF = 'rxlomoozakkjesdqjtvd'; // foot prod
const PAT = process.env.SUPABASE_ACCESS_TOKEN;
if (!PAT) { console.error('FATAL: SUPABASE_ACCESS_TOKEN 없음'); process.exit(1); }
async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }) });
  const out = await res.json().catch(() => null);
  if (res.status !== 200 && res.status !== 201) { console.error(`HTTP ${res.status}`, JSON.stringify(out)); process.exit(1); }
  return out;
}
const j = (x) => JSON.stringify(x, null, 2);

console.log('=== auth-context (postgres/무RLS 여야 함) ===');
console.log(j(await q(`SELECT current_user usr, current_setting('is_superuser') super;`)));

console.log('\n=== D0. reservations 컬럼 실재 (provenance 축 후보) ===');
console.log(j(await q(`SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='reservations'
  ORDER BY ordinal_position;`)));

console.log('\n=== D1. created_via CHECK 제약 존부 (STEP1-Q3) ===');
console.log(j(await q(`SELECT con.conname, pg_get_constraintdef(con.oid) def
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = rel.relnamespace
  WHERE n.nspname='public' AND rel.relname='reservations' AND con.contype='c'
    AND pg_get_constraintdef(con.oid) ILIKE '%created_via%';`)));

console.log('\n=== D1b. created_via 관련 enum 타입 존부 ===');
console.log(j(await q(`SELECT t.typname, e.enumlabel
  FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
  WHERE t.typname ILIKE '%created%via%' OR t.typname ILIKE '%creation%'
  ORDER BY t.typname, e.enumsortorder;`)));

console.log('\n=== D2. created_via 값 분포 (전체) ===');
console.log(j(await q(`SELECT created_via, count(*) n
  FROM public.reservations GROUP BY created_via ORDER BY n DESC;`)));

console.log('\n=== D3. source_system 값 분포 (전체) ===');
console.log(j(await q(`SELECT source_system, count(*) n
  FROM public.reservations GROUP BY source_system ORDER BY n DESC;`)));

console.log('\n=== D4. created_via NULL 행 = freeze-set 후보 총량 (187 대조) ===');
console.log(j(await q(`SELECT count(*) null_created_via_total FROM public.reservations WHERE created_via IS NULL;`)));

console.log('\n=== D5. created_via NULL 의 created_at min/max (pre-migration 경계 확인) ===');
console.log(j(await q(`SELECT min(created_at) min_at, max(created_at) max_at, count(*) n
  FROM public.reservations WHERE created_via IS NULL;`)));

console.log('\n=== D6. created_via NOT NULL 의 created_at min (컬럼 도입 경계 = 2026-06-28 대조) ===');
console.log(j(await q(`SELECT min(created_at) first_nonnull_at, max(created_at) last_nonnull_at, count(*) n
  FROM public.reservations WHERE created_via IS NOT NULL;`)));

console.log('\n=== 완료: discovery READ-ONLY. write/DDL 0. ===');
