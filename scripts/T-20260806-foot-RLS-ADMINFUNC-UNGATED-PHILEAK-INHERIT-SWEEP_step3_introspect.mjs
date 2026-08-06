#!/usr/bin/env node
/**
 * STEP3 PRE-WRITE INTROSPECTION (READ-ONLY · pure SELECT · no gate required)
 * Ticket: T-20260806-foot-RLS-ADMINFUNC-UNGATED-PHILEAK-INHERIT-SWEEP
 *
 * DA SSOT: agents/docs/da_replies/da_decision_foot_rls_adminfunc_ungated_phileak_inherit_sweep_20260806.md
 *
 * Captures the AUTHORITATIVE current prod definitions so the STEP3 migration can:
 *   (up)   forward CREATE OR REPLACE gated helper + ②-conjoin/③-exempt/carve/6menu wrap
 *   (down) restore the EXACT current (pre-STEP3) definitions
 * and resolves the two BLOCKING/선결 conditions:
 *   [선결 C2] non-authz caller census for the 3 ungated helpers
 *   [BLOCKING C5] SET-DIFF per-surface account census (role × approved × active)
 *
 * PHI: NO account email/name emitted — role/flag/count only.
 * exec: node scripts/T-...-INHERIT-SWEEP_step3_introspect.mjs > scripts/_evidence/step3_introspect.out 2>&1
 */
import { q } from './dryrun_lib.mjs';

const OUT = {};
const p = (k, v) => { OUT[k] = v; console.log(`\n===== ${k} =====`); console.log(JSON.stringify(v, null, 1)); };

// ── I1: exact current defs of the 3 UNGATED helpers + referenced authz primitives ──
const helpers = await q(`
  SELECT p.proname,
         pg_get_functiondef(p.oid) AS def,
         (pg_get_functiondef(p.oid) ILIKE '%is_approved_user%') AS has_gate
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname IN ('current_user_is_admin_or_manager','is_admin','is_manager_or_above',
                      'is_approved_user','current_user_role','role_level','current_user_staff_id',
                      'is_admin_or_manager')
  ORDER BY p.proname;`);
p('I1_helper_defs', helpers.map(r => ({ fn: r.proname, has_gate: r.has_gate, def: r.def })));

// ── I2: exact pg_policies rows for EVERY policy STEP3 will touch (② / ③ / carve / 6menu) ──
// full qual + with_check verbatim → both up-wrap and down-restore source of truth.
const touchTables = `'check_ins','packages','payments','daily_closings','daily_room_status',
  'user_profiles','customer_call_memos','customer_reservation_memos','customer_treatment_memos',
  'chart_doctor_memos','medical_charts','package_payments','package_sessions','packages',
  'customers','prescription_contraindications','staff','service_addon_assignments',
  'treatment_photos','financial_summaries','financial_summary_audit_logs','insurance_sync_runs',
  'services'`;
const pols = await q(`
  SELECT tablename, policyname, cmd, permissive, roles::text AS roles,
         COALESCE(qual,'')       AS qual,
         COALESCE(with_check,'') AS with_check
  FROM pg_policies
  WHERE schemaname='public' AND tablename IN (${touchTables})
  ORDER BY tablename, policyname;`);
p('I2_all_policies_on_touch_tables', pols);

// ── I2b: precise list of the ② inline + ③ + carve + 6menu policies named in census/DA ──
const named = await q(`
  SELECT tablename, policyname, cmd,
         COALESCE(qual,'')       AS qual,
         COALESCE(with_check,'') AS with_check
  FROM pg_policies
  WHERE schemaname='public' AND (
      policyname IN (
        'check_ins_insert','check_ins_update_privileged','check_ins_delete_admin',
        'check_ins_update_therapist_own',
        'customers_therap_update_6menu',
        'package_payments_write','package_sessions_write',
        'packages_insert','packages_update','packages_delete_admin',
        'payments_insert','payments_update','payments_delete_admin',
        'ppp_write','rx_contra_admin_write',
        'staff_coordinator_insert_staffcrud','staff_coordinator_update_staffcrud',
        'saaa_admin_read','treatment_photos_insert_staff','treatment_photos_update_staff',
        'user_profiles_delete_admin','user_profiles_read_own','user_profiles_update_own_or_admin',
        'user_profiles_insert_admin',
        'fs_deleted_rows_director_only','fsal_select_director_admin',
        'insurance_sync_runs_read_admin','daily_closings_write',
        'manage_update_ccm','manage_update_crm','manage_update_ctm',
        'cdm_director_clinic_v2','mc_clinic_isolated_v3','mc_deleted_rows_director_only'
      )
      OR policyname ILIKE '%_staff_unlock_6menu'
  )
  ORDER BY tablename, policyname;`);
p('I2b_named_target_policies', named);

// ── I3 [선결 C2]: non-authz caller census for the 3 ungated helpers ──
// (a) DB objects (functions/views) whose SOURCE references any of the 3 helpers, other than
//     RLS policy predicates (policies are the authz surface). Any function/view use = candidate
//     non-authz caller → must classify.
const fnRefs = await q(`
  SELECT p.proname AS referencing_fn,
         (SELECT string_agg(h, ',') FROM unnest(ARRAY['current_user_is_admin_or_manager','is_admin','is_manager_or_above']) h
          WHERE pg_get_functiondef(p.oid) ILIKE '%'||h||'%') AS refs
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname NOT IN ('current_user_is_admin_or_manager','is_admin','is_manager_or_above')
    AND ( pg_get_functiondef(p.oid) ILIKE '%current_user_is_admin_or_manager%'
       OR pg_get_functiondef(p.oid) ~* '\\mis_admin\\M'
       OR pg_get_functiondef(p.oid) ILIKE '%is_manager_or_above%' )
  ORDER BY p.proname;`);
p('I3a_function_callers_of_3_helpers', fnRefs);

const viewRefs = await q(`
  SELECT c.relname AS view_name, c.relkind,
         (SELECT string_agg(h, ',') FROM unnest(ARRAY['current_user_is_admin_or_manager','is_admin','is_manager_or_above']) h
          WHERE pg_get_viewdef(c.oid) ILIKE '%'||h||'%') AS refs
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('v','m')
    AND ( pg_get_viewdef(c.oid) ILIKE '%current_user_is_admin_or_manager%'
       OR pg_get_viewdef(c.oid) ~* '\\mis_admin\\M'
       OR pg_get_viewdef(c.oid) ILIKE '%is_manager_or_above%' )
  ORDER BY c.relname;`);
p('I3b_view_callers_of_3_helpers', viewRefs);

// (b) which RLS policies reference each of the 3 helpers (the authz surface — expected use).
const polRefs = await q(`
  SELECT h AS helper, count(*) AS policy_count,
         string_agg(tablename||'.'||policyname, ', ' ORDER BY tablename,policyname) AS policies
  FROM (
    SELECT tablename, policyname,
           COALESCE(qual,'')||' '||COALESCE(with_check,'') AS pred
    FROM pg_policies WHERE schemaname='public'
  ) x
  CROSS JOIN unnest(ARRAY['current_user_is_admin_or_manager','is_admin','is_manager_or_above']) h
  WHERE x.pred ILIKE '%'||h||'%'
  GROUP BY h ORDER BY h;`);
p('I3c_policy_refs_per_helper', polRefs);

// ── I4 [BLOCKING C5]: SET-DIFF account census — role × approved × active (counts only, no PII) ──
const accts = await q(`
  SELECT role::text AS role,
         approval_status,
         is_active,
         count(*) AS n
  FROM user_profiles
  GROUP BY role, approval_status, is_active
  ORDER BY role, approval_status, is_active;`);
p('I4_account_census_role_approval_active', accts);

// I4b: confirm is_approved_user() semantics = approval_status + is_active columns actually used
const gateDef = helpers.find(h => h.proname === 'is_approved_user');
p('I4b_is_approved_user_semantics', gateDef ? gateDef.def : '(NOT FOUND — must confirm gate primitive)');

// I4c: distinct approval_status values present (to build SET-DIFF predicate honestly)
const apprVals = await q(`SELECT DISTINCT approval_status FROM user_profiles ORDER BY 1;`);
p('I4c_distinct_approval_status', apprVals);

console.log('\n\n===== SUMMARY KEYS =====');
console.log(Object.keys(OUT).join('\n'));
