/**
 * DRY-RUN (No-Persistence): T-20260810-foot-RLS-ANON-LEGITPATH-DACONSULT
 *   20260810190000_foot_rls_anon_checklists_seal.sql  (ADDITIVE: CREATE POLICY x2)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip  ② plpgsql exception-handler 무영속 실행  ③ post-probe.
 *
 * ADDITIVE 마이그이므로 post-probe = "신규 restrictive 정책 prod 부재(=CREATE 롤백됨)" 실측.
 *   각 probe TRUE(pass) = dry-run 후 원상태(restrictive 미존재) 유지 = 무영속.
 *   하나라도 FALSE = 영속 누수(persistence leak) → FAIL.
 *
 * 실행: (repo root) node supabase/migrations/20260810190000_foot_rls_anon_checklists_seal.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260810190000_foot_rls_anon_checklists_seal.sql');

runDryrun({
  upPath: UP,
  passNote: '(ADDITIVE 마이그 — post-probe=신규 restrictive 정책 부재/무영속 실측)',
  assertAbsent: [
    { label: '(a) checklists.checklists_anon_read_deny CREATE rolled-back (absent)',
      sql: `SELECT (NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='checklists' AND policyname='checklists_anon_read_deny')) AS ok;` },
    { label: '(b) checklists.checklists_anon_write_deny CREATE rolled-back (absent)',
      sql: `SELECT (NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='checklists' AND policyname='checklists_anon_write_deny')) AS ok;` },
    // ADDITIVE 불변식: before-image anon permissive 직접정책은 dry-run 내내 무접촉으로 존치되어야 함.
    { label: '(c) checklists.anon_checklist_read still present (untouched)',
      sql: `SELECT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='checklists' AND policyname='anon_checklist_read') AS ok;` },
    { label: '(d) checklists.anon_checklist_write still present (untouched)',
      sql: `SELECT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='checklists' AND policyname='anon_checklist_write') AS ok;` },
    // C2 불변식: authenticated 정책 6종 무접촉(=6건 실재).
    { label: '(e) authenticated 정책 6종 present (C2 무접촉)',
      sql: `SELECT (count(*)=6) AS ok FROM pg_policies WHERE schemaname='public' AND tablename='checklists' AND policyname IN ('auth_users_all','checklists_admin_all','checklists_approved_read','checklists_consult_update','checklists_coord_insert','checklists_coord_update');` },
    // C1 불변식: SECDEF fn 무접촉(prosecdef=true 유지).
    { label: '(f) fn_complete_prescreen_checklist SECDEF(prosecdef=true) 무접촉 (C1)',
      sql: `SELECT (p.prosecdef IS TRUE) AS ok FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='fn_complete_prescreen_checklist';` },
  ],
});
