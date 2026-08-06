/**
 * DRY-RUN (No-Persistence): T-20260806-foot-PLANA-PKG-PAY-EXPAND
 *   20260807130000_foot_package_payments_cband_cat_canon.sql
 *   (package_payments ADDITIVE: payment_attempt_id uuid FK + partial UNIQUE + external_* idempotent 재선언)
 *
 * canonical 러너 scripts/dryrun_lib.mjs 위임(txn-control strip + plpgsql exception-rollback + assertAbsent post-probe).
 *   up.sql = BEGIN…COMMIT + ALTER ADD COLUMN IF NOT EXISTS ×3 + FK DO$$ + CREATE UNIQUE INDEX + COMMENT.
 *   stripTxnControl 이 top-level BEGIN;/COMMIT; 제거 → 나머지를 exception-handler 하 EXECUTE(무영속).
 *
 * ── 무영속 post-probe (INV-3) ────────────────────────────────────────────────
 *   · payment_attempt_id = net-new → 무영속 dry-run 후 prod ABSENT(columnAbsent=true) 실증(롤백 확인).
 *   · ux_package_payments_payment_attempt_id 인덱스 = net-new → 무영속 후 prod ABSENT 실증.
 *   ※ external_approval_no/external_tid 는 prod 기존(mig 20260523040000) = ADD IF NOT EXISTS no-op →
 *     columnAbsent probe 대상 아님(FALSE 나오는 게 정상 = 이미 존재). net-new 객체만 probe.
 *
 * 실행: (repo root) node supabase/migrations/20260807130000_foot_package_payments_cband_cat_canon.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN.
 * author: dev-foot / 2026-08-07
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun, columnAbsent } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260807130000_foot_package_payments_cband_cat_canon.sql');

const INDEX_ABSENT = {
  label: 'index public.ux_package_payments_payment_attempt_id',
  sql: "SELECT NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='ux_package_payments_payment_attempt_id') AS absent;",
};

await runDryrun({
  upPath: UP,
  assertAbsent: [
    columnAbsent('package_payments', 'payment_attempt_id'),
    INDEX_ABSENT,
  ],
  passNote:
    'ADDITIVE(payment_attempt_id FK + partial UNIQUE) 무영속 통과 — net-new 객체 prod ABSENT 실증(INV-3). ' +
    'external_* 는 20260523040000 기존(IF NOT EXISTS no-op).',
});
