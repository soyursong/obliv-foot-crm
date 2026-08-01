/**
 * DRY-RUN (No-Persistence): T-20260730-foot-REDPAY-PLANB-GOLIVE-0805-SCHEDULE-LOCK
 *   20260802061500_foot_record_planb_card_payment_rpc.sql
 *   (single RPC record_planb_card_payment 신설 — CREATE FUNCTION only, ADDITIVE)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip(top-level BEGIN/COMMIT 없음 — sentinel-bypass 차단)
 *   ② plpgsql exception-handler(DO..EXECUTE..EXCEPTION) 무영속 실행 — CREATE FUNCTION/GRANT 전부 txn-safe
 *   ③ post-probe procAbsent — dry-run 후 record_planb_card_payment prod 부재 실측(INV-3).
 *
 * up.sql = CREATE OR REPLACE FUNCTION + REVOKE/GRANT + COMMENT → 전부 txn-safe/가역 → 무영속 dry-run 적격
 *   (CONCURRENTLY·enum ADD VALUE 등 non-txn DDL 없음).
 *
 * 실행: (repo root) node supabase/migrations/20260802061500_foot_record_planb_card_payment_rpc.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun, procAbsent } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260802061500_foot_record_planb_card_payment_rpc.sql');

runDryrun({
  upPath: UP,
  assertAbsent: [
    procAbsent('record_planb_card_payment'),
  ],
});
