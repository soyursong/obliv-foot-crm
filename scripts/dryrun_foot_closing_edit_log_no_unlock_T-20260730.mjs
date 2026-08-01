/**
 * DRY-RUN (무영속) — T-20260730-foot-DAYCLOSE-CONFIRMED-EDIT-NO-UNLOCK
 * file:   supabase/migrations/20260801220000_foot_closing_edit_log_no_unlock.sql
 * 표준:   agents/docs/migration_dryrun_no_persistence_standard.md (strip + plpgsql exception-handler + post-probe)
 * 게이트:  db_change=true(ADDITIVE) → deploy-ready 전 무영속 PASS + post-probe absent 의무.
 * post-probe(INV-3): 마이그가 생성하는 오브젝트 2종 — table closing_edit_log + fn
 *   closing_edit_manual_payment_reconfirm — 사후 부재(무영속) 실측.
 * ref:    foot prod rxlomoozakkjesdqjtvd (dryrun_lib REF, env FOOT_SUPABASE_REF override 가능).
 * 사용:   node scripts/dryrun_foot_closing_edit_log_no_unlock_T-20260730.mjs
 */
import { runDryrun, regclassAbsent, procAbsent } from './dryrun_lib.mjs';

await runDryrun({
  upPath: 'supabase/migrations/20260801220000_foot_closing_edit_log_no_unlock.sql',
  assertAbsent: [
    regclassAbsent('public.closing_edit_log'),
    procAbsent('closing_edit_manual_payment_reconfirm'),
  ],
  passNote: '(T-DAYCLOSE-EDIT-NO-UNLOCK: closing_edit_log table + reconfirm RPC 무영속, herald port 미접촉)',
});
