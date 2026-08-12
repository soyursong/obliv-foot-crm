/**
 * DRY-RUN (No-Persistence): T-20260812-foot-ANONREVOKE-REFTABLES-EFF3
 *   20260812234000_foot_anonrevoke_reftables_eff3_seal.sql  (ADDITIVE: CREATE POLICY x3 RESTRICTIVE anon-deny)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip(BEGIN/COMMIT)  ② plpgsql exception-handler 무영속 실행  ③ post-probe.
 *
 * ADDITIVE 마이그이므로 post-probe = "신규 restrictive 정책 prod 부재(=CREATE 롤백됨)" 실측.
 *   각 probe TRUE(pass) = dry-run 후 원상태(restrictive 미존재) 유지 = 무영속.
 *   하나라도 FALSE = 영속 누수(persistence leak) → FAIL.
 * + ADDITIVE 불변식 probe = before-image permissive `TO public` 정책이 dry-run 내내 존치.
 *
 * 실행: (repo root) node supabase/migrations/20260812234000_foot_anonrevoke_reftables_eff3_seal.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260812234000_foot_anonrevoke_reftables_eff3_seal.sql');

runDryrun({
  upPath: UP,
  passNote: '(ADDITIVE 마이그 — post-probe=신규 restrictive anon-deny 3정책 부재/무영속 실측)',
  assertAbsent: [
    { label: '(a) redpay_terminal_registry.redpay_terminal_registry_anon_deny CREATE rolled-back (absent)',
      sql: `SELECT (NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='redpay_terminal_registry' AND policyname='redpay_terminal_registry_anon_deny')) AS ok;` },
    { label: '(b) form_templates.form_templates_anon_deny CREATE rolled-back (absent)',
      sql: `SELECT (NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='form_templates' AND policyname='form_templates_anon_deny')) AS ok;` },
    { label: '(c) room_role_mapping.room_role_mapping_anon_deny CREATE rolled-back (absent)',
      sql: `SELECT (NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='room_role_mapping' AND policyname='room_role_mapping_anon_deny')) AS ok;` },
    // ADDITIVE 불변식: before-image permissive `TO public` 정책은 dry-run 내내 무접촉 존치.
    { label: '(d) redpay_terminal_registry.redpay_terminal_registry_read_all still present (untouched)',
      sql: `SELECT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='redpay_terminal_registry' AND policyname='redpay_terminal_registry_read_all') AS ok;` },
    { label: '(e) form_templates.form_templates_read still present (untouched)',
      sql: `SELECT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='form_templates' AND policyname='form_templates_read') AS ok;` },
    { label: '(f) room_role_mapping.room_role_read still present (untouched)',
      sql: `SELECT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='room_role_mapping' AND policyname='room_role_read') AS ok;` },
  ],
});
