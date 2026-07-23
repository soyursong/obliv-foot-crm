/**
 * DRY-RUN (No-Persistence): T-20260723-foot-REDPAY-PLANB-DDL-BUILD
 *   20260723180100_foot_redpay_raw_received_at.sql (redpay_raw_transactions.received_at ADD COLUMN)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip ② plpgsql exception-handler 무영속 실행 ③ post-probe columnAbsent(INV-3).
 *
 * 실행: (repo root) node supabase/migrations/20260723180100_foot_redpay_raw_received_at.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun, columnAbsent } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260723180100_foot_redpay_raw_received_at.sql');

runDryrun({
  upPath: UP,
  assertAbsent: [
    columnAbsent('redpay_raw_transactions', 'received_at'),
  ],
  passNote: '(redpay_raw_transactions.received_at nullable 컬럼 무영속 검증)',
}).catch((e) => { console.error(e); process.exit(1); });
