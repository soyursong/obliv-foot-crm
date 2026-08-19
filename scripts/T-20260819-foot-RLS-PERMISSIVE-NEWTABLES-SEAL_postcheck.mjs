/**
 * POSTCHECK (READ-ONLY): T-20260819-foot-RLS-PERMISSIVE-NEWTABLES-SEAL (leg2) — AC4
 *   ★ GO-token apply 후 실행. 착지 상태(RESTRICTIVE 11종 실재 + offending permissive 존치) 실증.
 *   전부 SELECT introspection. WRITE 0 · DDL 0.
 *   실행: node scripts/T-20260819-foot-RLS-PERMISSIVE-NEWTABLES-SEAL_postcheck.mjs
 *
 * behavioral effective-authz(jongno staff read/write 유지·타clinic seal·admin bypass·anon 봉쇄)는
 * supervisor DB-GATE effective-session probe 소관(role-스위칭 JWT). 본 스크립트는 정책 착지/ADDITIVE 실증.
 */
import { q } from './dryrun_lib.mjs';

const CLINIC_GATE_ALL = [
  ['health_maintenance_balances', 'health_maintenance_balances_clinic_gate_restrict'],
  ['receipt_ocr_results',         'receipt_ocr_results_clinic_gate_restrict'],
  ['claim_diagnoses',             'claim_diagnoses_clinic_gate_restrict'],
  ['handover_notes',              'handover_notes_clinic_gate_restrict'],
  ['diagnosis_folders',           'diagnosis_folders_clinic_gate_restrict'],
  ['diagnosis_sets',              'diagnosis_sets_clinic_gate_restrict'],
  ['notices',                     'notices_clinic_gate_restrict'],
];
const CLINIC_GATE_SELECT = [
  ['payment_audit_logs',   'payment_audit_logs_clinic_read_restrict'],
  ['room_role_mapping',    'room_role_mapping_clinic_read_restrict'],
];
const ANON_DENY = [
  ['code_availability',              'code_availability_anon_deny'],
  ['redpay_unregistered_line_seen', 'redpay_unregistered_line_seen_anon_deny'],
];
const PERMISSIVE_KEEP = [
  ['health_maintenance_balances', 'auth_all'],
  ['payment_audit_logs',          'payment_audit_logs_open'],
  ['receipt_ocr_results',         'auth_all'],
  ['claim_diagnoses',             'claim_diagnoses_auth_all'],
  ['handover_notes',              'handover_notes_select'],
  ['diagnosis_folders',           'diagnosis_folders_read_all'],
  ['diagnosis_sets',              'diagnosis_sets_read_all'],
  ['notices',                     'notices_select_for_authenticated'],
  ['room_role_mapping',           'room_role_read'],
  ['code_availability',           'code_availability_select'],
  ['redpay_unregistered_line_seen', 'redpay_unregistered_line_seen_read_all'],
];

(async () => {
  let fail = 0;
  const rows = await q(`
    SELECT pp.tablename, pp.policyname, pp.permissive, pp.cmd, pp.roles::text AS roles,
           pg_get_expr(po.polqual, po.polrelid)      AS using_expr,
           pg_get_expr(po.polwithcheck, po.polrelid) AS check_expr
    FROM pg_policies pp
    JOIN pg_policy po ON po.polname = pp.policyname
    JOIN pg_class c ON c.oid = po.polrelid AND c.relname = pp.tablename
    WHERE pp.schemaname='public'
    ORDER BY pp.tablename, pp.policyname;`);
  const find = (t, p) => rows.find((r) => r.tablename === t && r.policyname === p);

  const check = (cond, msg) => { if (!cond) { console.log(`  ✗ FAIL: ${msg}`); fail++; } else console.log(`  ✓ ${msg}`); };

  console.log('## ALL-grain clinic-gate (RESTRICTIVE authenticated ALL, USING+CHECK canonical)');
  for (const [t, p] of CLINIC_GATE_ALL) {
    const r = find(t, p);
    check(r && r.permissive === 'RESTRICTIVE' && r.roles === '{authenticated}' && r.cmd === 'ALL'
      && /current_user_clinic_id\(\)/.test(r.using_expr || '') && /is_admin_or_manager\(\)/.test(r.using_expr || '')
      && /current_user_clinic_id\(\)/.test(r.check_expr || '') && /is_admin_or_manager\(\)/.test(r.check_expr || ''),
      `${t}.${p}`);
  }
  console.log('## SELECT-grain clinic-gate (RESTRICTIVE authenticated SELECT)');
  for (const [t, p] of CLINIC_GATE_SELECT) {
    const r = find(t, p);
    check(r && r.permissive === 'RESTRICTIVE' && r.roles === '{authenticated}' && r.cmd === 'SELECT'
      && /current_user_clinic_id\(\)/.test(r.using_expr || '') && /is_admin_or_manager\(\)/.test(r.using_expr || ''),
      `${t}.${p}`);
  }
  console.log('## anon-deny (RESTRICTIVE anon ALL false)');
  for (const [t, p] of ANON_DENY) {
    const r = find(t, p);
    check(r && r.permissive === 'RESTRICTIVE' && r.roles === '{anon}' && r.cmd === 'ALL'
      && (r.using_expr || '').trim().toLowerCase() === 'false', `${t}.${p}`);
  }
  console.log('## ADDITIVE — offending permissive 존치 (DROP 0)');
  for (const [t, p] of PERMISSIVE_KEEP) check(!!find(t, p), `${t}.${p} present`);

  console.log(`\n${fail === 0 ? '== POSTCHECK PASS ==' : `== POSTCHECK FAIL (${fail}) ==`}`);
  if (fail > 0) process.exit(1);
})();
