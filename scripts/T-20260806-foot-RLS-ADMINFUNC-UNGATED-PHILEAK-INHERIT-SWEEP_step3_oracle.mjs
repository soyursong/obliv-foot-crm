#!/usr/bin/env node
/**
 * STEP3 ACCEPTANCE-ORACLE completeness census (READ-ONLY, pre-apply).
 * AC3: 전 테이블 pg_policies → role-gated 이지만 is_approved_user() 게이트 부재인
 *      술어(=ungated privileged) 전수. 본 마이그 touch-list 가 이들을 완전 커버하는지
 *      (또는 helper-chokepoint 로 healing / own-leg exempt) 확인.
 */
import { q } from './dryrun_lib.mjs';
const p = (k, v) => { console.log(`\n===== ${k} =====`); console.log(JSON.stringify(v, null, 1)); };

// 모든 정책 중 (role-check 존재) AND (is_approved_user 부재) — ungated 후보 전수.
const ungated = await q(`
  SELECT tablename, policyname, cmd,
         (COALESCE(qual,'')||' '||COALESCE(with_check,'')) AS pred
  FROM pg_policies
  WHERE schemaname='public'
    AND (COALESCE(qual,'')||' '||COALESCE(with_check,'')) ~* '(current_user_role|current_user_is_admin_or_manager|is_admin|is_manager_or_above|role\\s*=|role\\s+IN|role\\s*=\\s*ANY)'
    AND (COALESCE(qual,'')||' '||COALESCE(with_check,'')) NOT ILIKE '%is_approved_user%'
    -- gated helper 경유는 이미 approved 게이트 포함 → 제외
    AND (COALESCE(qual,'')||' '||COALESCE(with_check,'')) !~* '\\mis_admin_or_manager\\s*\\('
    AND (COALESCE(qual,'')||' '||COALESCE(with_check,'')) !~* 'is_consultant_or_above\\s*\\('
    AND (COALESCE(qual,'')||' '||COALESCE(with_check,'')) !~* 'is_coordinator_or_above\\s*\\('
    AND (COALESCE(qual,'')||' '||COALESCE(with_check,'')) !~* 'is_doctor_role\\s*\\('
    AND (COALESCE(qual,'')||' '||COALESCE(with_check,'')) !~* 'is_floor_staff\\s*\\('
    AND (COALESCE(qual,'')||' '||COALESCE(with_check,'')) !~* 'is_therapist_or_technician\\s*\\('
    AND (COALESCE(qual,'')||' '||COALESCE(with_check,'')) !~* 'can_assign_rooms\\s*\\('
  ORDER BY tablename, policyname;`);

// classify against migration touch-list
const HELPER_HEALED = new Set([
  'check_ins_delete_admin','packages_delete_admin','payments_delete_admin',
  'daily_closings_write','insurance_sync_runs_read_admin',
]);
const TOUCHED = new Set([
  'check_ins_insert','check_ins_update_privileged','check_ins_update_therapist_own',
  'customers_therap_update_6menu','package_payments_write','package_sessions_write',
  'packages_insert','packages_update','payments_insert','payments_update','ppp_write',
  'rx_contra_admin_write','staff_coordinator_insert_staffcrud','staff_coordinator_update_staffcrud',
  'saaa_admin_read','treatment_photos_insert_staff','treatment_photos_update_staff',
  'user_profiles_delete_admin','fs_deleted_rows_director_only','fsal_select_director_admin',
  'daily_closings_staff_unlock_6menu','daily_room_status_staff_unlock_6menu',
  'package_payments_staff_unlock_6menu','packages_staff_unlock_6menu','services_staff_unlock_6menu',
  'user_profiles_read_own','user_profiles_update_own_or_admin','user_profiles_insert_admin',
  'manage_update_ccm','manage_update_crm','manage_update_ctm',
  'cdm_director_clinic_v2','mc_clinic_isolated_v3','mc_deleted_rows_director_only',
]);

const classified = ungated.map(r => {
  let disp;
  if (TOUCHED.has(r.policyname)) disp = 'TOUCHED (wrapped)';
  else if (HELPER_HEALED.has(r.policyname)) disp = 'HELPER-HEALED (chokepoint)';
  else disp = '⚠ UNCOVERED — INVESTIGATE';
  return { tablename: r.tablename, policyname: r.policyname, cmd: r.cmd, disposition: disp };
});
p('ORACLE_all_ungated_predicates', classified);

const uncovered = classified.filter(c => c.disposition.startsWith('⚠'));
p('ORACLE_UNCOVERED_count', { total_ungated: classified.length, touched: classified.filter(c=>c.disposition.startsWith('TOUCHED')).length, helper_healed: classified.filter(c=>c.disposition.startsWith('HELPER')).length, uncovered: uncovered.length, uncovered_list: uncovered });
