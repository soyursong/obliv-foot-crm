// READ-ONLY RCA — T-20260813-foot-MIGLEDGER-20260813120000-PHANTOM-RECONCILE
// prod write 0. SELECT / introspection only.
import { query } from '/Users/domas/GitHub/obliv-foot-crm/scripts/lib/foot_migration_ledger.mjs';
const j = (o) => JSON.stringify(o, null, 2);
const rows = async (sql) => { const r = await query(sql); return Array.isArray(r) ? r : (r?.[0] ? r : []); };

console.log('#################### RCA READ-ONLY ####################\n');

// 1) ledger table columns
console.log('=== [1a] schema_migrations columns ===');
console.log(j(await rows(`SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='supabase_migrations' AND table_name='schema_migrations' ORDER BY ordinal_position;`)));

// 1b) the target row 20260813120000 — full dump
console.log('\n=== [1b] ROW version=20260813120000 (name, created_by, statements preview) ===');
console.log(j(await rows(`SELECT version, name, created_by, left(array_to_string(statements, ' ||| '), 400) AS statements_preview, array_length(statements,1) AS stmt_count FROM supabase_migrations.schema_migrations WHERE version='20260813120000';`)));

// 1c) child version + recent rows for collision context
console.log('\n=== [1c] recent ledger rows (>= 20260812000000) ===');
console.log(j(await rows(`SELECT version, name, created_by FROM supabase_migrations.schema_migrations WHERE version >= '20260812000000' ORDER BY version;`)));

// 1d) numbering collision scan — any duplicate versions
console.log('\n=== [1d] duplicate-version scan (collision in ledger) ===');
console.log(j(await rows(`SELECT version, count(*) c FROM supabase_migrations.schema_migrations GROUP BY version HAVING count(*)>1;`)));

// 2) prod actual — view-leg
console.log('\n=== [2a] v_daily_visits viewdef (is_test filter?) ===');
const vdv = await rows(`SELECT pg_get_viewdef('public.v_daily_visits'::regclass, true) AS def;`).catch(e=>[{def:'ERR:'+e.message}]);
console.log((vdv[0]?.def||'').slice(0,1200));
console.log('  -> contains is_test:', /is_test/i.test(vdv[0]?.def||''));

console.log('\n=== [2b] v_daily_visit_rate viewdef (is_test filter?) ===');
const vdr = await rows(`SELECT pg_get_viewdef('public.v_daily_visit_rate'::regclass, true) AS def;`).catch(e=>[{def:'ERR:'+e.message}]);
console.log((vdr[0]?.def||'').slice(0,1200));
console.log('  -> contains is_test:', /is_test/i.test(vdr[0]?.def||''));

// 2c) data-leg customers.is_test
console.log('\n=== [2c] customers.is_test counts ===');
console.log(j(await rows(`SELECT count(*) FILTER (WHERE is_test IS TRUE) AS is_test_true, count(*) FILTER (WHERE is_test IS FALSE) AS is_test_false, count(*) FILTER (WHERE is_test IS NULL) AS is_test_null, count(*) FILTER (WHERE created_at < '2026-07-13 00:00:00+09') AS pre_0713_total FROM public.customers;`)));

// 3) partial-DDL / orphan — audit table + closing_enqueue marker
console.log('\n=== [3a] backfill_audit_20260812_istest table existence (orphan check) ===');
console.log(j(await rows(`SELECT table_schema, table_name FROM information_schema.tables WHERE table_name ILIKE '%backfill_audit%20260812%istest%' OR table_name ILIKE 'backfill_audit_20260812_istest';`)));

console.log('\n=== [3b] enqueue_closing_confirmed marker (did the COLLIDING closing_enqueue mig apply?) ===');
console.log(j(await rows(`SELECT p.proname, (p.prosrc LIKE '%INV1-SPLITSIGN-DECOUPLE%') AS has_decouple_marker, (p.prosrc LIKE '%v_split_sign_ok%') AS has_split_sign_ok FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname='enqueue_closing_confirmed';`)));

console.log('\n#################### END RCA ####################');
