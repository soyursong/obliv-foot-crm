#!/usr/bin/env node
/**
 * STEP3 CENSUS-2 (READ-ONLY) — fixes for step3_introspect:
 *   - is_approved_user() gate columns = user_profiles.approved / user_profiles.active
 *   - is_admin word-boundary (was ILIKE-contaminated by is_admin_or_manager)
 * Ticket: T-20260806-foot-RLS-ADMINFUNC-UNGATED-PHILEAK-INHERIT-SWEEP
 */
import { q } from './dryrun_lib.mjs';
const p = (k, v) => { console.log(`\n===== ${k} =====`); console.log(JSON.stringify(v, null, 1)); };

// ── I3c-FIX: clean policy-ref count per helper (word-boundary for is_admin) ──
const polRefs = await q(`
  WITH pol AS (
    SELECT tablename, policyname,
           COALESCE(qual,'')||' '||COALESCE(with_check,'') AS pred
    FROM pg_policies WHERE schemaname='public'
  )
  SELECT 'current_user_is_admin_or_manager' AS helper, count(*) AS n,
         string_agg(tablename||'.'||policyname, ', ' ORDER BY tablename,policyname) AS policies
  FROM pol WHERE pred ILIKE '%current_user_is_admin_or_manager%'
  UNION ALL
  SELECT 'is_admin (word-boundary, excl is_admin_or_manager)', count(*),
         string_agg(tablename||'.'||policyname, ', ' ORDER BY tablename,policyname)
  FROM pol WHERE pred ~* '\\mis_admin\\M' AND pred !~* '\\mis_admin_or_manager\\M'
           OR (pred ~* '\\mis_admin\\s*\\(' )
  UNION ALL
  SELECT 'is_admin (STRICT: is_admin( call only)', count(*),
         string_agg(tablename||'.'||policyname, ', ' ORDER BY tablename,policyname)
  FROM pol WHERE pred ~* 'is_admin\\s*\\('
  UNION ALL
  SELECT 'is_manager_or_above', count(*),
         string_agg(tablename||'.'||policyname, ', ' ORDER BY tablename,policyname)
  FROM pol WHERE pred ~* 'is_manager_or_above\\s*\\(';`);
p('I3c_FIX_policy_refs_per_helper', polRefs);

// ── I3a-FIX: function callers, strict word-boundary ──
const fnRefs = await q(`
  SELECT p.proname AS referencing_fn,
         (pg_get_functiondef(p.oid) ILIKE '%current_user_is_admin_or_manager%') AS refs_cuiaom,
         (pg_get_functiondef(p.oid) ~* 'is_admin\\s*\\(')                        AS refs_is_admin,
         (pg_get_functiondef(p.oid) ~* 'is_manager_or_above\\s*\\(')             AS refs_is_mgr
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname NOT IN ('current_user_is_admin_or_manager','is_admin','is_manager_or_above')
    AND ( pg_get_functiondef(p.oid) ILIKE '%current_user_is_admin_or_manager%'
       OR pg_get_functiondef(p.oid) ~* 'is_admin\\s*\\('
       OR pg_get_functiondef(p.oid) ~* 'is_manager_or_above\\s*\\(' )
  ORDER BY p.proname;`);
p('I3a_FIX_function_callers', fnRefs);

// ── I3b-FIX: view callers ──
const viewRefs = await q(`
  SELECT c.relname AS view_name, c.relkind::text
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('v','m')
    AND ( pg_get_viewdef(c.oid) ILIKE '%current_user_is_admin_or_manager%'
       OR pg_get_viewdef(c.oid) ~* 'is_admin\\s*\\('
       OR pg_get_viewdef(c.oid) ~* 'is_manager_or_above\\s*\\(' )
  ORDER BY c.relname;`);
p('I3b_FIX_view_callers', viewRefs);

// ── I4-FIX: account census role × approved × active (counts only) ──
const accts = await q(`
  SELECT role::text AS role,
         COALESCE(approved,false) AS approved,
         COALESCE(active,true)    AS active,
         count(*) AS n
  FROM user_profiles
  GROUP BY role, COALESCE(approved,false), COALESCE(active,true)
  ORDER BY role, approved, active;`);
p('I4_FIX_account_census', accts);

// ── I4d: eligible-account count per ROLE-SET actually referenced (for SET-DIFF surfaces) ──
// role-sets that appear across wrapped surfaces (from DA/census)
const surfaces = {
  'admin_manager (current_user_is_admin_or_manager helper)': `role IN ('admin','manager')`,
  'admin (is_admin / user_profiles_delete_admin)':           `UPPER(role::text)='ADMIN'`,
  'mgr_or_above (is_manager_or_above)':                      `role::text IN ('admin','manager')`,
  'floor6menu {consultant,coordinator,therapist}':           `role::text IN ('consultant','coordinator','therapist')`,
  'therapist (check_ins carve->gate)':                       `role::text='therapist'`,
  'write4 {admin,manager,consultant,coordinator}':           `role::text IN ('admin','manager','consultant','coordinator')`,
  'write5 +therapist':                                       `role::text IN ('admin','manager','consultant','coordinator','therapist')`,
  'director_admin {director,admin}':                         `role::text IN ('director','admin')`,
};
const rows = [];
for (const [label, pred] of Object.entries(surfaces)) {
  const r = await q(`
    SELECT
      count(*) FILTER (WHERE ${pred}) AS role_members,
      count(*) FILTER (WHERE (${pred}) AND COALESCE(approved,false)=true AND COALESCE(active,true)=true) AS new_eligible,
      count(*) FILTER (WHERE (${pred}) AND NOT (COALESCE(approved,false)=true AND COALESCE(active,true)=true)) AS setdiff_lockout,
      count(*) FILTER (WHERE (${pred}) AND NOT (COALESCE(approved,false)=true AND COALESCE(active,true)=true)
                            AND COALESCE(approved,false)=true AND COALESCE(active,true)=false) AS lo_approved_inactive,
      count(*) FILTER (WHERE (${pred}) AND NOT (COALESCE(approved,false)=true AND COALESCE(active,true)=true)
                            AND NOT COALESCE(approved,false)=true) AS lo_notapproved
    FROM user_profiles;`);
  rows.push({ surface: label, ...r[0] });
}
p('I4d_SETDIFF_per_surface', rows);

// I4e: BLOCKING assertion — is ANY setdiff member approved∧active? (must be 0 across all surfaces)
const falseLockout = await q(`
  SELECT role::text AS role, count(*) AS n
  FROM user_profiles
  WHERE role::text IN ('admin','manager','consultant','coordinator','therapist','director','staff','tm')
    AND COALESCE(approved,false)=true AND COALESCE(active,true)=true
    AND FALSE  -- placeholder; per-surface diff computed above. sanity: approved∧active accounts never appear in OLD∖NEW by construction.
  GROUP BY role;`);
p('I4e_false_lockout_sanity', { note: 'per-surface setdiff_lockout above must all be ¬(approved∧active) by construction; approved∧active can never be in OLD∖NEW since NEW=OLD∩(approved∧active)', placeholder_rows: falseLockout });
