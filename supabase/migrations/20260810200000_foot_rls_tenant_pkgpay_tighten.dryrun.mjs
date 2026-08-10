/**
 * DRY-RUN (No-Persistence): DA-20260810-foot-RLS-TENANT-PKGPAY-TIGHTEN
 *   20260810200000_foot_rls_tenant_pkgpay_tighten.sql  (ADDITIVE: CREATE POLICY x1)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip  ② plpgsql exception-handler 무영속 실행  ③ post-probe.
 *
 * ADDITIVE 마이그이므로 post-probe = "신규 restrictive 정책 prod 부재(=CREATE 롤백됨)" 실측.
 *   각 probe TRUE(pass) = dry-run 후 원상태(restrictive 미존재) 유지 = 무영속.
 *   하나라도 FALSE = 영속 누수(persistence leak) → FAIL.
 *
 * 실행: node supabase/migrations/20260810200000_foot_rls_tenant_pkgpay_tighten.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260810200000_foot_rls_tenant_pkgpay_tighten.sql');

runDryrun({
  upPath: UP,
  passNote: '(ADDITIVE 마이그 — post-probe=신규 restrictive 정책 부재/무영속 실측)',
  assertAbsent: [
    { label: '(a) package_payments.package_payments_tenant_isolation CREATE rolled-back (absent)',
      sql: `SELECT (NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='package_payments' AND policyname='package_payments_tenant_isolation')) AS ok;` },
    // ADDITIVE 불변식: 기존 permissive write/read 정책은 dry-run 내내 무접촉으로 존치.
    { label: '(b) package_payments_write (permissive) still present (untouched)',
      sql: `SELECT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='package_payments' AND policyname='package_payments_write') AS ok;` },
    { label: '(c) package_payments_read (permissive) still present (untouched)',
      sql: `SELECT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='package_payments' AND policyname='package_payments_read') AS ok;` },
  ],
});
