/**
 * DRY-RUN (No-Persistence): T-20260723-foot-RESV-CANCEL-FROM-SOURCE-RPC
 *   20260723200000_foot_cancel_reservation_from_source_rpc.sql (신규 RPC cancel_reservation_from_source)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip(top-level BEGIN;/COMMIT; 제거, sentinel-bypass 차단)
 *   ② plpgsql exception-handler(DO..EXECUTE..EXCEPTION) 무영속 실행
 *   ③ post-probe procAbsent — dry-run 후 함수 prod 부재 실측(INV-3, 무영속 확인).
 *
 * 실행: (repo root) node supabase/migrations/20260723200000_foot_cancel_reservation_from_source_rpc.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun, procAbsent } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260723200000_foot_cancel_reservation_from_source_rpc.sql');

runDryrun({
  upPath: UP,
  assertAbsent: [
    procAbsent('cancel_reservation_from_source'),   // dry-run 후 함수 무영속(prod 부재) 확인
  ],
  passNote: '(cancel_reservation_from_source 함수 무영속 검증)',
}).catch((e) => { console.error(e); process.exit(1); });
