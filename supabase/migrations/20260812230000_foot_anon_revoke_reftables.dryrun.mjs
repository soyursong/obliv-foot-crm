/**
 * DRY-RUN (No-Persistence): T-20260812-foot-ANON-REVOKE-REFTABLES
 *   20260812230000_foot_anon_revoke_reftables.sql  (DESTRUCTIVE grant-axis: REVOKE ALL x5 — INERT subset, 8→5 re-scope)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip  ② plpgsql exception-handler 무영속 실행  ③ post-probe.
 *
 * REVOKE 마이그의 무영속 판정: REVOKE 의 "효과"는 anon grant 제거다. dry-run 이 무영속이면
 *   rollback 후 anon grant 는 여전히 존치(=REVOKE 효과 부재)여야 한다.
 *   각 probe = `has_table_privilege('anon', <table>, 'SELECT')` → TRUE(anon 여전히 SELECT 보유)
 *   = REVOKE 효과 rolled-back = 무영속 PASS. 하나라도 FALSE = REVOKE 영속(persistence leak) → FAIL.
 *
 *   전제(DA census firsthand 2026-08-12): 8 target 은 INERT = anon SELECT grant 존치.
 *   probe FALSE = (a) REVOKE 영속 누수 OR (b) census drift(이미 grant 부재) — 둘 다 apply 前 확인 필요 → FAIL 정당.
 *
 * 실행: (repo root) node supabase/migrations/20260812230000_foot_anon_revoke_reftables.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260812230000_foot_anon_revoke_reftables.sql');

// ★ INERT subset 5/8 (behavioral-401 self-front 확증). EFFECTIVE 3(form_templates·
//   redpay_terminal_registry·room_role_mapping)=DEFERRED(DA 재-CONSULT) → 본 마이그 제외.
const TABLES = [
  'call_type_codes', 'check_in_services', 'clinic_holidays', 'clinic_schedules', 'prescription_codes',
];

runDryrun({
  upPath: UP,
  passNote: '(REVOKE 마이그 — post-probe=anon SELECT grant 존치(REVOKE 효과 부재)/무영속 실측)',
  assertAbsent: TABLES.map((t, i) => ({
    label: `(${String.fromCharCode(97 + i)}) ${t}: anon SELECT grant 존치(REVOKE 무영속)`,
    sql: `SELECT has_table_privilege('anon', 'public.${t}', 'SELECT') AS ok;`,
  })),
});
