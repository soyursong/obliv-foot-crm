import { query } from './lib/foot_migration_ledger.mjs';
import { writeFileSync } from 'node:fs';

for (const fn of ['transfer_package_atomic','consume_package_sessions_for_checkin']) {
  const r = await query(`
    SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='${fn}';`);
  const def = r[0]?.def || '';
  writeFileSync(`/tmp/prod_${fn}.sql`, def);
  console.log(`--- ${fn}: ${def.length} bytes -> /tmp/prod_${fn}.sql`);
}

// ambient check: ACL of sibling functions applied recently via same file path + a few random public fns
const acls = await query(`
  SELECT p.proname, p.proacl::text AS acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
     AND p.proname IN ('get_package_remaining','calc_refund_amount','refund_package_atomic')
   ORDER BY p.proname;`);
console.log('=== SIBLING pkg FUNCTION ACLs ==='); console.log(JSON.stringify(acls, null, 2));

// how many public functions have anon in acl vs not (ambient classification)
const stat = await query(`
  SELECT
    count(*) FILTER (WHERE p.proacl::text LIKE '%anon=X%') AS with_anon,
    count(*) FILTER (WHERE p.proacl IS NOT NULL AND p.proacl::text NOT LIKE '%anon=X%') AS acl_no_anon,
    count(*) FILTER (WHERE p.proacl IS NULL) AS acl_null,
    count(*) AS total
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prokind='f';`);
console.log('=== PUBLIC FUNCTION ACL DISTRIBUTION ==='); console.log(JSON.stringify(stat));
