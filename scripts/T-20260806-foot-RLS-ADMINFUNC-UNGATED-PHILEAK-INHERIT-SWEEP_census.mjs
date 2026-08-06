#!/usr/bin/env node
/**
 * STEP1 CENSUS (READ-ONLY · pure SELECT introspection · no gate required)
 * Ticket: T-20260806-foot-RLS-ADMINFUNC-UNGATED-PHILEAK-INHERIT-SWEEP
 *
 * foot HARD lockout census — foot는 물리 분리 DB·자기 LIVE 계정공간·자기 role-set.
 * body(parent) C1~C6 패턴은 참조하되 재사용 금지: foot prod에서 독립 실측.
 *
 * C1 공유 함수(current_user_is_admin_or_manager 계열) 목록 + 게이팅 여부
 * C2 참조 정책·테이블 전수 (check_ins/payments/packages delete_admin + daily_closings_write)
 * C3 제2 인라인 계열 + 3분류(self-scoped carve / 특권 / hybrid)
 * C4 foot 노출 계정 SET-DIFF(정직/비활성 admin) + role-set parity(director)
 * C5 finance-tier 커플링
 *
 * PHI: 계정 email/name 미출력(role/flag/count만). 정책·함수 델타만.
 * 실행: node scripts/T-...-INHERIT-SWEEP_census.mjs > scripts/_evidence/census_foot_....out 2>&1
 */
import { q } from './dryrun_lib.mjs';

const OUT = {};
const p = (k, v) => { OUT[k] = v; console.log(`\n===== ${k} =====`); console.log(JSON.stringify(v, null, 1)); };

// ── C1: 함수 계열 게이팅 census ──────────────────────────────────────────────
const c1 = await q(`
  SELECT p.proname,
         (pg_get_functiondef(p.oid) ILIKE '%is_approved_user%') AS has_gate,
         pg_get_functiondef(p.oid) AS def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.prorettype='boolean'::regtype
    AND (pg_get_functiondef(p.oid) ILIKE '%user_profiles%'
         OR pg_get_functiondef(p.oid) ILIKE '%current_user_role%')
    AND pg_get_functiondef(p.oid) ILIKE '%role%'
  ORDER BY has_gate, p.proname;`);
p('C1_authz_helper_functions', c1.map(r => ({ fn: r.proname, has_gate: r.has_gate, def: r.def.replace(/\s+/g, ' ').trim() })));

// ── C2: 지정 정책 3+daily_closings 전수 ───────────────────────────────────────
const c2 = await q(`
  SELECT tablename, policyname, cmd, roles,
         COALESCE(qual,'')       AS qual,
         COALESCE(with_check,'') AS with_check
  FROM pg_policies
  WHERE schemaname='public'
    AND ( policyname ILIKE '%delete_admin%'
       OR tablename='daily_closings'
       OR (tablename IN ('check_ins','payments','packages') AND policyname ILIKE '%delete%') )
  ORDER BY tablename, policyname;`);
p('C2_named_policies_deleteadmin_dailyclosings', c2);

// ── C3: 인라인 계열 전수 + 3분류 ──────────────────────────────────────────────
// ungated 후보 = current_user_role() / is_admin / current_user_is_admin_or_manager / is_manager_or_above
// 참조하면서 is_approved_user 게이트 부재
const c3 = await q(`
  WITH pol AS (
    SELECT tablename, policyname, cmd, roles,
           COALESCE(qual,'')||' '||COALESCE(with_check,'') AS pred,
           COALESCE(qual,'')       AS qual,
           COALESCE(with_check,'') AS with_check
    FROM pg_policies WHERE schemaname='public'
  )
  SELECT tablename, policyname, cmd, qual, with_check,
    (pred ILIKE '%is_approved_user%')                                       AS gated,
    (pred ILIKE '%auth.uid()%' OR pred ILIKE '%current_user_staff_id%')     AS has_ownrow_leg,
    (pred ILIKE '%current_user_role()%'
     OR pred ILIKE '%current_user_is_admin_or_manager%'
     OR pred ILIKE '%is_admin(%' OR pred ILIKE '% is_admin()%'
     OR pred ILIKE '%is_manager_or_above%')                                 AS has_role_leg
  FROM pol
  WHERE (pred ILIKE '%current_user_role()%'
     OR pred ILIKE '%current_user_is_admin_or_manager%'
     OR pred ILIKE '%is_admin(%' OR pred ILIKE '% is_admin()%'
     OR pred ILIKE '%is_manager_or_above%')
  ORDER BY gated, tablename, policyname;`);
// 3분류
const classify = (r) => {
  if (!r.gated) {
    if (r.has_ownrow_leg && r.has_role_leg) return 'UNGATED_HYBRID(③)';
    if (r.has_ownrow_leg) return 'SELF_SCOPED_CARVE(①)';
    return 'UNGATED_PRIVILEGED(②)';
  }
  return 'ALREADY_GATED';
};
p('C3_inline_family_classified', c3.map(r => ({
  table: r.tablename, policy: r.policyname, cmd: r.cmd,
  class: classify(r), gated: r.gated, ownrow: r.has_ownrow_leg,
  qual: r.qual, with_check: r.with_check })));

// C3-summary: ungated 잔존 총계(acceptance oracle 예비)
const c3sum = await q(`
  SELECT count(*) AS ungated_bare_role_predicates
  FROM pg_policies
  WHERE schemaname='public'
    AND (COALESCE(qual,'')||' '||COALESCE(with_check,'')) ILIKE '%current_user_role()%'
    AND (COALESCE(qual,'')||' '||COALESCE(with_check,'')) NOT ILIKE '%is_approved_user%'
    AND (COALESCE(qual,'')||' '||COALESCE(with_check,'')) NOT ILIKE '%auth.uid()%'
    AND (COALESCE(qual,'')||' '||COALESCE(with_check,'')) NOT ILIKE '%current_user_staff_id%';`);
p('C3_summary_ungated_bare_role_count', c3sum);

// ── C4: 계정 SET-DIFF + role-set parity (PHI-free: role/flag/count only) ──────
const c4 = await q(`
  SELECT role,
         COALESCE(approved,false) AS approved,
         COALESCE(active,true)    AS active,
         (COALESCE(approved,false)=true AND COALESCE(active,true)=true) AS is_approved_user_eq,
         count(*) AS n
  FROM user_profiles
  GROUP BY 1,2,3,4 ORDER BY role, approved, active;`);
p('C4a_account_roleflag_matrix', c4);

// 노출 계정: 특권 role인데 ¬(approved∧active) = HARD lockout 대상(수혜자였던 계정)
const c4exposed = await q(`
  SELECT role,
         COALESCE(approved,false) AS approved,
         COALESCE(active,true)    AS active,
         count(*) AS n
  FROM user_profiles
  WHERE role IN ('admin','manager','director')
    AND NOT (COALESCE(approved,false)=true AND COALESCE(active,true)=true)
  GROUP BY 1,2,3 ORDER BY role;`);
p('C4b_exposed_privileged_accounts_NOT_approved_active', c4exposed);

// distinct roles present (role-set parity — director 존재 여부)
const c4roles = await q(`SELECT DISTINCT role FROM user_profiles ORDER BY role;`);
p('C4c_distinct_roles_present', c4roles.map(r=>r.role));

// ── C5: finance-tier 커플링 (daily_closings / payments write 정책) ────────────
const c5 = await q(`
  SELECT tablename, policyname, cmd,
         COALESCE(qual,'')       AS qual,
         COALESCE(with_check,'') AS with_check,
         ((COALESCE(qual,'')||' '||COALESCE(with_check,'')) ILIKE '%is_approved_user%') AS gated
  FROM pg_policies
  WHERE schemaname='public'
    AND tablename IN ('daily_closings','payments','package_payments')
  ORDER BY tablename, policyname;`);
p('C5_finance_tier_policies', c5);

console.log('\n\n##### CENSUS COMPLETE #####');
