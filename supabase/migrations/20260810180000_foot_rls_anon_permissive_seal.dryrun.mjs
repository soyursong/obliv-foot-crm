/**
 * DRY-RUN (No-Persistence): T-20260810-foot-RLS-ANON-PERMISSIVE-SEAL
 *   20260810180000_foot_rls_anon_permissive_seal.sql  (ADDITIVE: CREATE POLICY x2)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip  ② plpgsql exception-handler 무영속 실행  ③ post-probe.
 *
 * ADDITIVE 마이그이므로 post-probe = "신규 restrictive 정책 prod 부재(=CREATE 롤백됨)" 실측.
 *   각 probe TRUE(pass) = dry-run 후 원상태(restrictive 미존재) 유지 = 무영속.
 *   하나라도 FALSE = 영속 누수(persistence leak) → FAIL.
 *
 * 실행: (repo root) node supabase/migrations/20260810180000_foot_rls_anon_permissive_seal.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260810180000_foot_rls_anon_permissive_seal.sql');

runDryrun({
  upPath: UP,
  passNote: '(ADDITIVE 마이그 — post-probe=신규 restrictive 정책 부재/무영속 실측)',
  assertAbsent: [
    { label: '(a) services.services_anon_deny CREATE rolled-back (absent)',
      sql: `SELECT (NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='services' AND policyname='services_anon_deny')) AS ok;` },
    { label: '(b) package_tiers.package_tiers_anon_deny CREATE rolled-back (absent)',
      sql: `SELECT (NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='package_tiers' AND policyname='package_tiers_anon_deny')) AS ok;` },
    // ADDITIVE 불변식: before-image permissive anon-read 정책은 dry-run 내내 무접촉으로 존치되어야 함.
    { label: '(c) services.anon_service_read still present (untouched)',
      sql: `SELECT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='services' AND policyname='anon_service_read') AS ok;` },
    { label: '(d) package_tiers.anon_read_package_tiers still present (untouched)',
      sql: `SELECT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='package_tiers' AND policyname='anon_read_package_tiers') AS ok;` },
  ],
});
