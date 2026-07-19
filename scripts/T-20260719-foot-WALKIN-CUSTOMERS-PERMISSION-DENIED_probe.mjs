/**
 * T-20260719-foot-WALKIN-CUSTOMERS-PERMISSION-DENIED — READ-ONLY 진단 probe
 *
 * ⚠ READ-ONLY. introspection 전용. INSERT/UPDATE/DELETE/DDL/GRANT/REVOKE 절대 없음.
 * 목적: 워크인 anon 접수 42501(permission denied for table customers) RC 격리.
 *   1) fn_selfcheckin_upsert_customer_resolve_v3 의 prosecdef(SECURITY DEFINER?) + owner + EXECUTE grant
 *   2) customers 테이블 owner + INSERT/UPDATE grant(anon/authenticated/postgres/PUBLIC) + RLS/FORCE 여부
 *   3) v3 정의가 오늘(20260719) createdby 마이그로 재작성됐는지(created_by 컬럼 참조 여부 + 시그니처)
 *   4) 함수 owner 롤이 customers INSERT 가능한 실효 권한을 갖는지 (has_table_privilege)
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
  }
}
const c = new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });
await c.connect();
console.log('✅ DB 연결 (read-only probe)\n');

// ── (1) v3 함수: SECURITY DEFINER? owner? EXECUTE grant? ──
const v3 = await c.query(`
  SELECT p.proname,
         p.prosecdef                          AS security_definer,
         pg_get_userbyid(p.proowner)          AS owner_role,
         pg_get_function_identity_arguments(p.oid) AS args,
         (pg_get_functiondef(p.oid) ~* 'created_by') AS refs_created_by
  FROM pg_proc p
  WHERE p.pronamespace='public'::regnamespace
    AND p.proname='fn_selfcheckin_upsert_customer_resolve_v3'
  ORDER BY p.oid`);
console.log('── (1) resolve_v3 정의 (prosecdef=t 여야 정상) ──');
console.table(v3.rows.map(r => ({ owner: r.owner_role, SEC_DEFINER: r.security_definer, refs_created_by: r.refs_created_by, args: (r.args||'').slice(0,60) })));

for (const r of v3.rows) {
  const g = await c.query(`
    SELECT rr.rolname FROM pg_proc p
    JOIN LATERAL aclexplode(p.proacl) a ON true
    JOIN pg_roles rr ON rr.oid=a.grantee
    WHERE p.oid=$1 AND a.privilege_type='EXECUTE' AND rr.rolname IN ('anon','authenticated')`, [r.oid ?? 0]);
}
const v3grant = await c.query(`
  SELECT rr.rolname FROM pg_proc p
  JOIN LATERAL aclexplode(p.proacl) a ON true
  JOIN pg_roles rr ON rr.oid=a.grantee
  WHERE p.proname='fn_selfcheckin_upsert_customer_resolve_v3' AND p.pronamespace='public'::regnamespace
    AND a.privilege_type='EXECUTE' AND rr.rolname IN ('anon','authenticated')`);
console.log('   v3 EXECUTE grant:', v3grant.rows.map(r=>r.rolname).join(',') || '(none/PUBLIC)');

// ── (2) customers 테이블: owner + RLS + INSERT/UPDATE grant ──
const tbl = await c.query(`
  SELECT c.relname, pg_get_userbyid(c.relowner) AS owner_role, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
  FROM pg_class c WHERE c.relname='customers' AND c.relnamespace='public'::regnamespace`);
console.log('\n── (2) customers 테이블 owner / RLS ──');
console.table(tbl.rows);

const grants = await c.query(`
  SELECT grantee, privilege_type
  FROM information_schema.role_table_grants
  WHERE table_schema='public' AND table_name='customers'
    AND privilege_type IN ('INSERT','UPDATE','SELECT','DELETE')
  ORDER BY grantee, privilege_type`);
console.log('── customers 테이블 grant (INSERT/UPDATE/SELECT/DELETE) ──');
console.table(grants.rows);

// ── (3) 함수 owner 롤의 customers INSERT 실효권한 ──
const ownerRole = v3.rows[0]?.owner_role;
if (ownerRole) {
  const eff = await c.query(`SELECT has_table_privilege($1,'public.customers','INSERT') AS owner_can_insert,
                                    has_table_privilege($1,'public.customers','UPDATE') AS owner_can_update`, [ownerRole]);
  console.log(`\n── (3) 함수 owner(${ownerRole}) 의 customers 실효권한 ──`);
  console.table(eff.rows);
  const isSuper = await c.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=$1`, [ownerRole]);
  console.log(`   owner rolsuper/bypassrls:`, isSuper.rows[0]);
}

// ── (4) anon/authenticated 실효 customers INSERT (직접경로 차단 확인) ──
const roleEff = await c.query(`
  SELECT r AS role,
         has_table_privilege(r,'public.customers','INSERT') AS can_insert
  FROM unnest(ARRAY['anon','authenticated','postgres']) AS r`);
console.log('\n── (4) 롤별 customers 직접 INSERT 실효권한 ──');
console.table(roleEff.rows);

await c.end();
console.log('\n✅ probe 완료 (무변경).');
