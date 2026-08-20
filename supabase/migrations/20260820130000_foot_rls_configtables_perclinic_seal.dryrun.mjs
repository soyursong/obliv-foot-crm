/**
 * DRY-RUN (No-Persistence): T-20260820-foot-RLS-CONFIGTABLES-SHARED-PERCLINIC-GOVERNANCE
 *   20260820130000_foot_rls_configtables_perclinic_seal.sql (ADDITIVE: CREATE POLICY x3)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip  ② plpgsql exception-handler 무영속 실행  ③ post-probe.
 *
 * ADDITIVE 마이그이므로 post-probe = "신규 restrictive 정책 3종 prod 부재(=CREATE 롤백됨)" +
 *   "봉쇄대상 offending permissive 정책 3종 존치(무접촉)" 실측.
 *   각 probe TRUE(pass) = dry-run 후 원상태 유지 = 무영속. 하나라도 FALSE = 영속 누수 → FAIL.
 *
 * 실행: node supabase/migrations/20260820130000_foot_rls_configtables_perclinic_seal.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260820130000_foot_rls_configtables_perclinic_seal.sql');

const absent = (table, policy) => ({
  label: `(absent) ${table}.${policy} CREATE rolled-back`,
  sql: `SELECT (NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='${table}' AND policyname='${policy}')) AS ok;`,
});
const present = (table, policy) => ({
  label: `(untouched) ${table}.${policy} permissive still present`,
  sql: `SELECT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='${table}' AND policyname='${policy}') AS ok;`,
});

runDryrun({
  upPath: UP,
  passNote: '(ADDITIVE — post-probe=신규 restrictive 3종 부재/무영속 + offending permissive 3종 존치 실측)',
  assertAbsent: [
    // 신규 restrictive 3종 = dry-run 후 롤백되어 부재여야 함
    absent('form_templates',    'form_templates_clinic_read_restrict'),
    absent('treatment_sets',    'treatment_sets_clinic_gate_restrict'),
    absent('code_availability', 'code_availability_clinic_read_restrict'),
    // ADDITIVE 불변식: 봉쇄대상 offending permissive 정책은 무접촉 존치
    present('form_templates',    'form_templates_read'),
    present('treatment_sets',    'authenticated_all_treatment_sets'),
    present('code_availability', 'code_availability_select'),
  ],
});
