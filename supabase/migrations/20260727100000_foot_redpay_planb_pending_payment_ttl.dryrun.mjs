/**
 * DRY-RUN (No-Persistence): T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD
 *   20260727100000_foot_redpay_planb_pending_payment_ttl.sql
 *   (pending_payment TTL/lock/failure 축 ADDITIVE — expires_at/locked_until/fail_reason + CHECK widen)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip(top-level BEGIN;/COMMIT; 제거, sentinel-bypass 차단)
 *   ② plpgsql exception-handler(DO..EXECUTE..EXCEPTION) 무영속 실행
 *   ③ post-probe assertAbsent — dry-run 후 신규 컬럼 3종 부재 + widen CHECK('failed') 미영속 실측(INV-3).
 *
 * 실행: (repo root) node supabase/migrations/20260727100000_foot_redpay_planb_pending_payment_ttl.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun, columnAbsent } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260727100000_foot_redpay_planb_pending_payment_ttl.sql');

// widen CHECK('failed') 미영속 실측 — dry-run 후 CHECK def 에 'failed' 부재 = TRUE(absent).
const widenCheckAbsent = {
  label: "CHECK widen 'failed' on pending_payment (non-persistent)",
  sql: `SELECT NOT EXISTS(
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'public.pending_payment'::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) ILIKE '%failed%'
        ) AS absent;`,
};

runDryrun({
  upPath: UP,
  assertAbsent: [
    columnAbsent('pending_payment', 'expires_at'),
    columnAbsent('pending_payment', 'locked_until'),
    columnAbsent('pending_payment', 'fail_reason'),
    widenCheckAbsent,
  ],
  passNote: '(expires_at/locked_until/fail_reason 컬럼 + failed CHECK widen 무영속 검증)',
}).catch((e) => { console.error(e); process.exit(1); });
