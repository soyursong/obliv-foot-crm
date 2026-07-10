import { query } from './lib/foot_migration_ledger.mjs';

// 1) 함수 정의: search_path 핀 + SECDEF + body 내 마스킹 로직 존재 확인
const fn = await query(`
  SELECT p.proname,
         p.proconfig,
         p.prosecdef,
         pg_get_userbyid(p.proowner) AS owner,
         (pg_get_functiondef(p.oid) ILIKE '%repeat(%*%')      AS has_name_mask,
         (pg_get_functiondef(p.oid) ILIKE '%regexp_replace%')  AS has_phone_mask,
         (pg_get_functiondef(p.oid) ILIKE '%right(regexp_replace%') AS phone_tail4
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='fn_selfcheckin_today_reservations';`);
console.log('=== FUNCTION DEF ==='); console.log(JSON.stringify(fn, null, 2));

// 2) anon EXECUTE 유지
const priv = await query(`
  SELECT has_function_privilege('anon','public.fn_selfcheckin_today_reservations(uuid,date)','EXECUTE') AS anon_exec,
         has_function_privilege('authenticated','public.fn_selfcheckin_today_reservations(uuid,date)','EXECUTE') AS auth_exec;`);
console.log('=== PRIVILEGES ==='); console.log(JSON.stringify(priv));

// 3) ledger 반영
const ledger = await query("SELECT version, name FROM supabase_migrations.schema_migrations WHERE version='20260711120000';");
console.log('=== LEDGER 20260711120000 ==='); console.log(JSON.stringify(ledger));
