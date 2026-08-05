/**
 * STAGE-1 HARD lockout census — READ-ONLY prod introspection (DDL/DML 0)
 * T-20260805-foot-USERPROFILES-CROSSROW-RLS-REMEDIATE
 *
 * 6 census items (ticket §STAGE-1 / DA g1k9 §Q2 lockout census):
 *   1. user_profiles pg_policies 전수 (permissive UPDATE 정책 명명 3종 + OOB)
 *   2. (FE code — separate grep) cross-row 정당 write-path
 *   3. set-difference OLD ∖ NEW (derived from 1/2/4)
 *   4. ★승인 write-path + user_profiles_update_own_or_admin "admin" leg manager 포함?
 *   5. guard 발화조건·보호 컬럼 (access_tier/active 미보호?·타 write-role)
 *   6. authenticated 전컬럼 UPDATE grant + 컬럼-REVOKE 0
 *
 * 실행: node scripts/T-20260805-foot-USERPROFILES-CROSSROW-RLS-REMEDIATE_census.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN. 전부 SELECT (READ-ONLY).
 */
import { q } from './dryrun_lib.mjs';

const out = (label, rows) => {
  console.log('\n===== ' + label + ' =====');
  console.log(JSON.stringify(rows, null, 2));
};

// ── 1. user_profiles 전 RLS 정책 전수 (cmd·roles·qual·with_check) ──
const policies = await q(`
  SELECT policyname, cmd, permissive, roles::text AS roles, qual, with_check
  FROM pg_policies
  WHERE schemaname='public' AND tablename='user_profiles'
  ORDER BY cmd, policyname;`);
out('1. user_profiles pg_policies 전수', policies.result ?? policies);

// ── 5a. guard 트리거 목록 (user_profiles) ──
const triggers = await q(`
  SELECT t.tgname, t.tgenabled,
         pg_get_triggerdef(t.oid) AS triggerdef
  FROM pg_trigger t
  JOIN pg_class c ON c.oid=t.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='user_profiles' AND NOT t.tgisinternal
  ORDER BY t.tgname;`);
out('5a. user_profiles 트리거 목록', triggers.result ?? triggers);

// ── 5b. guard 함수 소스 (self_guard 계열 — 보호 컬럼 확인) ──
const guardFns = await q(`
  SELECT p.proname, pg_get_functiondef(p.oid) AS def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname ~* 'self_guard|user_profiles.*guard|guard.*user_profiles';`);
out('5b. guard 함수 소스', guardFns.result ?? guardFns);

// ── 4a. is_approved_user() 정의 ──
const isApproved = await q(`
  SELECT p.proname, pg_get_functiondef(p.oid) AS def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='is_approved_user';`);
out('4a. is_approved_user() 정의', isApproved.result ?? isApproved);

// ── 4b. admin/manager 판정 함수 (update_own_or_admin qual 이 참조하는 술어) ──
const adminFns = await q(`
  SELECT p.proname, pg_get_functiondef(p.oid) AS def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname ~* 'is_admin|is_manager|current_user_role|is_admin_user|has_role|is_staff_admin';`);
out('4b. admin/manager 판정 함수', adminFns.result ?? adminFns);

// ── 4c. 계정 승인 관련 함수 (admin_approve / approve_signup / approve_user) ──
const approveFns = await q(`
  SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
         l.lanname, p.prosecdef,
         pg_get_functiondef(p.oid) AS def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  JOIN pg_language l ON l.oid=p.prolang
  WHERE n.nspname='public'
    AND p.proname ~* 'approve|approval|signup|activate_user|grant_access';`);
out('4c. 계정 승인 관련 함수 (SECDEF 여부 포함)', approveFns.result ?? approveFns);

// ── 6. authenticated grant (컬럼-level 포함) on user_profiles ──
const tableGrants = await q(`
  SELECT grantee, privilege_type, is_grantable
  FROM information_schema.role_table_grants
  WHERE table_schema='public' AND table_name='user_profiles'
    AND grantee IN ('authenticated','anon','service_role')
  ORDER BY grantee, privilege_type;`);
out('6a. table-level grants (authenticated/anon/service_role)', tableGrants.result ?? tableGrants);

const colGrants = await q(`
  SELECT grantee, column_name, privilege_type
  FROM information_schema.column_privileges
  WHERE table_schema='public' AND table_name='user_profiles'
    AND grantee IN ('authenticated','anon')
    AND privilege_type='UPDATE'
  ORDER BY grantee, column_name;`);
out('6b. column-level UPDATE grants (컬럼-REVOKE 유무 판정)', colGrants.result ?? colGrants);

// ── 5c. user_profiles 컬럼 목록 (access_tier/active 존재·guard 보호대상 대조) ──
const cols = await q(`
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='user_profiles'
  ORDER BY ordinal_position;`);
out('5c. user_profiles 컬럼 목록', cols.result ?? cols);

// ── RLS enabled 여부 ──
const rls = await q(`
  SELECT relname, relrowsecurity, relforcerowsecurity
  FROM pg_class WHERE relname='user_profiles' AND relnamespace='public'::regnamespace;`);
out('0. user_profiles RLS enabled', rls.result ?? rls);

console.log('\n===== CENSUS DONE (READ-ONLY · DDL/DML 0) =====');
