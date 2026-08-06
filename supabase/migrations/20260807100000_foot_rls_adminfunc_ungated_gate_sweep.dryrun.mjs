#!/usr/bin/env node
/**
 * No-Persistence dry-run — T-20260806-foot-RLS-ADMINFUNC-UNGATED-PHILEAK-INHERIT-SWEEP
 * 표준: agents/docs/migration_dryrun_no_persistence_standard.md (INV-1~5)
 *
 * 본 마이그는 CREATE OR REPLACE FUNCTION + ALTER POLICY (기존 오브젝트 MODIFY).
 * → post-probe = 무영속 dry-run 후 '게이트(is_approved_user)가 여전히 부재'인지
 *   실측(gate ABSENT = 변경 미영속). 각 probe 는 부재 시 boolean TRUE 반환.
 */
import { runDryrun } from '../../scripts/dryrun_lib.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const upPath = join(here, '20260807100000_foot_rls_adminfunc_ungated_gate_sweep.sql');

const fnUngated = (name) => ({
  label: `fn ${name} still ungated (gate not persisted)`,
  sql: `SELECT bool_and(pg_get_functiondef(p.oid) NOT ILIKE '%is_approved_user%') AS absent
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='${name}';`,
});
const polUngated = (table, policy, col) => ({
  label: `policy ${policy}.${col} still ungated (gate not persisted)`,
  sql: `SELECT COALESCE(bool_and(COALESCE(${col},'') NOT ILIKE '%is_approved_user%'), true) AS absent
        FROM pg_policies WHERE schemaname='public' AND tablename='${table}' AND policyname='${policy}';`,
});

await runDryrun({
  upPath,
  passNote: '(RLS admin-func ungated gate sweep — modify-only, gate-absent post-probe)',
  assertAbsent: [
    fnUngated('current_user_is_admin_or_manager'),
    fnUngated('is_admin'),
    fnUngated('is_manager_or_above'),
    polUngated('daily_closings', 'daily_closings_staff_unlock_6menu', 'qual'),
    polUngated('payments', 'payments_insert', 'with_check'),
    polUngated('customers', 'customers_therap_update_6menu', 'qual'),
    polUngated('user_profiles', 'user_profiles_read_own', 'qual'),
    polUngated('medical_charts', 'mc_clinic_isolated_v3', 'qual'),
    polUngated('customer_consult_memos', 'manage_update_ccm', 'qual'),
  ],
});
