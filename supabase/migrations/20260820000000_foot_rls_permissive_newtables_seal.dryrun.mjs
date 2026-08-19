/**
 * DRY-RUN (No-Persistence): T-20260819-foot-RLS-PERMISSIVE-NEWTABLES-SEAL (leg2)
 *   20260820000000_foot_rls_permissive_newtables_seal.sql (ADDITIVE: CREATE POLICY x11)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip  ② plpgsql exception-handler 무영속 실행  ③ post-probe.
 *
 * ADDITIVE 마이그이므로 post-probe = "신규 restrictive 정책 11종 prod 부재(=CREATE 롤백됨)" +
 *   "봉쇄대상 offending permissive 정책 11종 존치(무접촉)" 실측.
 *   각 probe TRUE(pass) = dry-run 후 원상태 유지 = 무영속. 하나라도 FALSE = 영속 누수 → FAIL.
 *
 * 실행: node supabase/migrations/20260820000000_foot_rls_permissive_newtables_seal.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260820000000_foot_rls_permissive_newtables_seal.sql');

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
  passNote: '(ADDITIVE — post-probe=신규 restrictive 11종 부재/무영속 + offending permissive 11종 존치 실측)',
  assertAbsent: [
    // 신규 restrictive 11종 = dry-run 후 롤백되어 부재여야 함
    absent('health_maintenance_balances', 'health_maintenance_balances_clinic_gate_restrict'),
    absent('payment_audit_logs',          'payment_audit_logs_clinic_read_restrict'),
    absent('receipt_ocr_results',         'receipt_ocr_results_clinic_gate_restrict'),
    absent('claim_diagnoses',             'claim_diagnoses_clinic_gate_restrict'),
    absent('handover_notes',              'handover_notes_clinic_gate_restrict'),
    absent('diagnosis_folders',           'diagnosis_folders_clinic_gate_restrict'),
    absent('diagnosis_sets',              'diagnosis_sets_clinic_gate_restrict'),
    absent('notices',                     'notices_clinic_gate_restrict'),
    absent('room_role_mapping',           'room_role_mapping_clinic_read_restrict'),
    absent('code_availability',           'code_availability_anon_deny'),
    absent('redpay_unregistered_line_seen', 'redpay_unregistered_line_seen_anon_deny'),
    // ADDITIVE 불변식: 봉쇄대상 offending permissive 정책은 무접촉 존치
    present('health_maintenance_balances', 'auth_all'),
    present('payment_audit_logs',          'payment_audit_logs_open'),
    present('receipt_ocr_results',         'auth_all'),
    present('claim_diagnoses',             'claim_diagnoses_auth_all'),
    present('handover_notes',              'handover_notes_select'),
    present('diagnosis_folders',           'diagnosis_folders_read_all'),
    present('diagnosis_sets',              'diagnosis_sets_read_all'),
    present('notices',                     'notices_select_for_authenticated'),
    present('room_role_mapping',           'room_role_read'),
    present('code_availability',           'code_availability_select'),
    present('redpay_unregistered_line_seen', 'redpay_unregistered_line_seen_read_all'),
  ],
});
