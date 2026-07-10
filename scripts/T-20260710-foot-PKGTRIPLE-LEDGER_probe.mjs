import { query } from './lib/foot_migration_ledger.mjs';

const ledger = await query("SELECT version, name, created_by FROM supabase_migrations.schema_migrations WHERE version='20260703040000';");
console.log('=== LEDGER 20260703040000 ==='); console.log(JSON.stringify(ledger));

const fns = await query(`
  SELECT p.proname,
         pg_get_function_identity_arguments(p.oid) AS args,
         p.prosecdef AS security_definer,
         pg_get_userbyid(p.proowner) AS owner
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
     AND p.proname IN ('transfer_package_atomic','consume_package_sessions_for_checkin')
   ORDER BY p.proname;`);
console.log('=== FUNCTIONS ==='); console.log(JSON.stringify(fns, null, 2));

const grants = await query(`
  SELECT p.proname, p.proacl::text AS acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
     AND p.proname IN ('transfer_package_atomic','consume_package_sessions_for_checkin')
   ORDER BY p.proname;`);
console.log('=== GRANTS (proacl) ==='); console.log(JSON.stringify(grants, null, 2));

const ledgerMax = await query("SELECT max(version) AS maxv, count(*) AS n FROM supabase_migrations.schema_migrations;");
console.log('=== LEDGER SUMMARY ==='); console.log(JSON.stringify(ledgerMax));
