/**
 * DRY-RUN (No-Persistence): T-20260805-foot-USERPROFILES-CROSSROW-RLS-REMEDIATE
 *   20260805180000_foot_userprofiles_crossrow_rls_remediate.sql
 *   (DROP POLICY + CREATE OR REPLACE FUNCTION + 트리거 재배선 = TRANSFORM DDL, ADDITIVE 아님)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip(top-level BEGIN/COMMIT 제거 — sentinel-bypass 차단)
 *   ② plpgsql exception-handler(DO..EXECUTE..EXCEPTION) 무영속 실행 —
 *      DROP POLICY / CREATE OR REPLACE FUNCTION / DROP+CREATE TRIGGER 전부 txn-safe.
 *   ③ post-probe: ★TRANSFORM 마이그이므로 "신규 오브젝트 부재"가 아니라 "원상태 복원(non-persistence)"
 *      을 실측한다. 각 probe 는 dry-run 롤백 후 prod 가 UP-이전 상태로 남아있으면 TRUE(=pass):
 *        · (a)  `approved users update profiles` 정책이 여전히 존재 (DROP 롤백됨)
 *        · (b1) self_guard 함수 def 에 access_tier 미포함 (CREATE OR REPLACE 롤백됨 = 구 3컬럼 def)
 *        · (b2) force_safe_insert 함수 def 에 exempt_from_restrictions 미포함 (exempt 코어싱 롤백됨)
 *      셋 중 하나라도 FALSE = 영속 누수(persistence leak) → FAIL.
 *
 * 실행: (repo root) node supabase/migrations/20260805180000_foot_userprofiles_crossrow_rls_remediate.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260805180000_foot_userprofiles_crossrow_rls_remediate.sql');

runDryrun({
  upPath: UP,
  passNote: '(TRANSFORM 마이그 — post-probe=원상태 복원/무영속 실측)',
  assertAbsent: [
    // (a) DROP 롤백 실증: OOB 정책 여전히 present → non-persistent.
    { label: '(a) OOB policy DROP rolled-back (still present)',
      sql: `SELECT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_profiles' AND policyname='approved users update profiles') AS ok;` },
    // (b1) self_guard CREATE OR REPLACE 롤백 실증: def 에 access_tier 미포함(=구 3컬럼 def) → non-persistent.
    { label: '(b1) self_guard fn REPLACE rolled-back (access_tier absent from def)',
      sql: `SELECT (position('access_tier' IN COALESCE((SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='user_profiles_self_guard'),''))=0) AS ok;` },
    // (b2) force_safe_insert CREATE OR REPLACE 롤백 실증: def 에 exempt_from_restrictions 미포함(=구 def) → non-persistent.
    { label: '(b2) force_safe_insert fn REPLACE rolled-back (exempt_from_restrictions absent from def)',
      sql: `SELECT (position('exempt_from_restrictions' IN COALESCE((SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='user_profiles_force_safe_insert'),''))=0) AS ok;` },
  ],
});
