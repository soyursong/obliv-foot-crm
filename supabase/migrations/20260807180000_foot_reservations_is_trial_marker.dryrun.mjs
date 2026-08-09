/**
 * DRY-RUN (No-Persistence): T-20260807-foot-CONSULTASSIGN-TRIAL-EXCL-CHART2
 *   20260807180000_foot_reservations_is_trial_marker.sql
 *   (metadata-only fast-ADD: reservations.is_trial BOOLEAN NOT NULL DEFAULT false + COMMENT)
 *
 * canonical 러너 scripts/dryrun_lib.mjs 위임(txn-control strip + plpgsql exception-rollback + assertAbsent post-probe).
 *   up.sql = BEGIN…COMMIT + ALTER TABLE ADD COLUMN IF NOT EXISTS + COMMENT.
 *   stripTxnControl 이 top-level BEGIN;/COMMIT; 제거 → 나머지를 exception-handler 하 EXECUTE(무영속).
 *
 * ── 무영속 post-probe (INV-3) — ADD COLUMN → 무영속 dry-run 후 prod ABSENT 실증(롤백 확인) ──
 *   · column  public.reservations.is_trial → columnAbsent
 *
 * 실행: (repo root) node supabase/migrations/20260807180000_foot_reservations_is_trial_marker.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN.
 * author: dev-foot / 2026-08-07
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun, columnAbsent } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260807180000_foot_reservations_is_trial_marker.sql');

await runDryrun({
  upPath: UP,
  assertAbsent: [columnAbsent('reservations', 'is_trial')],
});
