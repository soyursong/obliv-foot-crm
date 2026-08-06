#!/usr/bin/env node
import { q } from './dryrun_lib.mjs';
const p = (k, v) => { console.log(`\n===== ${k} =====`); console.log(JSON.stringify(v, null, 1)); };
const names = [
 'adtc_write','alp_write','arw_write','attendance_audit_select_mgr','attendance_device_select_mgr',
 'attendance_punch_select_mgr','clinic_dashboard_layouts_delete','clinic_dashboard_layouts_insert',
 'clinic_dashboard_layouts_update','clinic_memos_delete','clinic_memos_insert','clinic_memos_update',
 'admin_write_document_templates','duty_roster_delete','duty_roster_delete_coordinator','duty_roster_insert',
 'duty_roster_insert_coordinator','duty_roster_update','duty_roster_update_coordinator',
 'admin_write_phrase_templates','staffarea_write_phrases','admin_write_prescription_sets',
 'admin_write_quick_rx_buttons','redpay_gap_select_admin','resv_registrars_delete','resv_registrars_insert',
 'resv_registrars_update','room_role_write','staff_attendance_delete','staff_attendance_insert',
 'staff_attendance_update','admin_write_super_phrases'];
const rows = await q(`
  SELECT tablename, policyname, cmd,
         COALESCE(qual,'') AS qual, COALESCE(with_check,'') AS with_check
  FROM pg_policies WHERE schemaname='public' AND policyname = ANY (ARRAY[${names.map(n=>`'${n}'`).join(',')}])
  ORDER BY tablename, policyname;`);
p('UNCOVERED_32_full_predicates', rows);

// classify: does predicate call current_user_role()/3-helpers (=真 ungated authz) vs merely reference a `role` column?
const cls = rows.map(r => {
  const pred = (r.qual+' '+r.with_check);
  const usesCUR = /current_user_role\s*\(/i.test(pred);
  const uses3helper = /current_user_is_admin_or_manager\s*\(|(^|[^_])is_admin\s*\(|is_manager_or_above\s*\(/i.test(pred);
  const rowRoleOnly = !usesCUR && !uses3helper;
  return { policyname: r.policyname, cmd: r.cmd, uses_current_user_role: usesCUR, uses_3helper: uses3helper, row_role_col_only_FALSEPOS: rowRoleOnly };
});
p('UNCOVERED_32_classification', cls);
p('SUMMARY', {
  total: cls.length,
  genuine_ungated_authz: cls.filter(c=>c.uses_current_user_role||c.uses_3helper).length,
  false_positive_row_role_col: cls.filter(c=>c.row_role_col_only_FALSEPOS).length,
});
