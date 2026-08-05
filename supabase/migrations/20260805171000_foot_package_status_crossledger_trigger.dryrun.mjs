/**
 * DRY-RUN (No-Persistence): T-20260805-foot-REPAY-PKGLINK-REVTRANSITION-FWDFIX §2
 *   20260805171000_foot_package_status_crossledger_trigger.sql
 *   (신규 함수 2 + 신규 트리거 2 = ADDITIVE forward DDL)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip(top-level BEGIN/COMMIT 제거 — sentinel-bypass 차단)
 *   ② plpgsql exception-handler(DO..EXECUTE..EXCEPTION) 무영속 실행 —
 *      CREATE FUNCTION/CREATE TRIGGER/COMMENT 전부 txn-safe(CONCURRENTLY·enum ADD VALUE 없음)
 *   ③ post-probe absence — dry-run 후 신규 오브젝트 prod 부재 실측(INV-3):
 *        · proc foot_recompute_package_status / foot_trg_recompute_package_status
 *        · trigger trg_payments_pkg_status_recompute (payments)
 *        · trigger trg_pkgpay_pkg_status_recompute (package_payments)
 *
 * 실행: (repo root) node supabase/migrations/20260805171000_foot_package_status_crossledger_trigger.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun, procAbsent, triggerAbsent } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260805171000_foot_package_status_crossledger_trigger.sql');

runDryrun({
  upPath: UP,
  assertAbsent: [
    procAbsent('foot_recompute_package_status'),
    procAbsent('foot_trg_recompute_package_status'),
    triggerAbsent('trg_payments_pkg_status_recompute', 'payments'),
    triggerAbsent('trg_pkgpay_pkg_status_recompute', 'package_payments'),
  ],
});
