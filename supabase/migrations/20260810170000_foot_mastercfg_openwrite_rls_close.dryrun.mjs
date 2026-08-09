/**
 * DRY-RUN (No-Persistence): T-20260810-foot-RLS-MASTERCFG-OPENWRITE-CLOSE
 *   20260810170000_foot_mastercfg_openwrite_rls_close.sql
 *   (DROP POLICY + CREATE POLICY = TRANSFORM DDL, ADDITIVE 아님)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip(top-level BEGIN/COMMIT 제거 — sentinel-bypass 차단)
 *   ② plpgsql exception-handler(DO..EXECUTE..EXCEPTION) 무영속 실행 — DROP/CREATE POLICY 전부 txn-safe.
 *   ③ post-probe: ★TRANSFORM 마이그이므로 "원상태 복원(non-persistence)"을 실측한다.
 *      각 probe 는 dry-run 롤백 후 prod 가 UP-이전 상태로 남아있으면 TRUE(=pass):
 *        · (a) fee_set_templates.auth_all 여전히 존재 (DROP 롤백됨)
 *        · (b) package_templates.auth_all 여전히 존재 (DROP 롤백됨)
 *        · (c) fee_set_templates_staff_clinic_all 부재 (CREATE 롤백됨)
 *        · (d) package_templates_staff_read 부재 (CREATE 롤백됨)
 *      넷 중 하나라도 FALSE = 영속 누수(persistence leak) → FAIL.
 *
 * 실행: (repo root) node supabase/migrations/20260810170000_foot_mastercfg_openwrite_rls_close.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260810170000_foot_mastercfg_openwrite_rls_close.sql');

runDryrun({
  upPath: UP,
  passNote: '(TRANSFORM 마이그 — post-probe=원상태 복원/무영속 실측)',
  assertAbsent: [
    // (a) fee auth_all DROP 롤백 실증: 여전히 present → non-persistent.
    { label: '(a) fee_set_templates.auth_all DROP rolled-back (still present)',
      sql: `SELECT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='fee_set_templates' AND policyname='auth_all') AS ok;` },
    // (b) pkg auth_all DROP 롤백 실증: 여전히 present → non-persistent.
    { label: '(b) package_templates.auth_all DROP rolled-back (still present)',
      sql: `SELECT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='package_templates' AND policyname='auth_all') AS ok;` },
    // (c) fee canonical CREATE 롤백 실증: 신규 정책 부재 → non-persistent.
    { label: '(c) fee_set_templates_staff_clinic_all CREATE rolled-back (absent)',
      sql: `SELECT (NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='fee_set_templates' AND policyname='fee_set_templates_staff_clinic_all')) AS ok;` },
    // (d) pkg canonical CREATE 롤백 실증: 신규 정책 부재 → non-persistent.
    { label: '(d) package_templates_staff_read CREATE rolled-back (absent)',
      sql: `SELECT (NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='package_templates' AND policyname='package_templates_staff_read')) AS ok;` },
  ],
});
