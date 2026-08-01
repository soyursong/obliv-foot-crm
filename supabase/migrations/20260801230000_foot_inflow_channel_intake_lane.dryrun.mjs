/**
 * DRY-RUN (No-Persistence): T-20260801-foot-INFLOW-CHANNEL-INTAKE-LANE
 *   20260801230000_foot_inflow_channel_intake_lane.sql
 *   (dual-anchor 3컬럼 nullable ADDITIVE + system_codes/code_availability 신규 테이블
 *    + 11코드 시드 + get_inflow_channels RPC)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip(top-level BEGIN/COMMIT 없음 — sentinel-bypass 차단)
 *   ② plpgsql exception-handler(DO..EXECUTE..EXCEPTION) 무영속 실행
 *   ③ post-probe assertAbsent — dry-run 후 신규 컬럼/테이블/RPC prod 부재 실측(INV-3).
 *   ⚠ up.sql = ADD COLUMN(nullable) + CREATE TABLE + INSERT ON CONFLICT + CREATE POLICY
 *     + CREATE OR REPLACE FUNCTION → 전부 txn-safe/가역 → 무영속 dry-run 적격
 *     (CONCURRENTLY·enum ADD VALUE 등 non-txn DDL 없음).
 *
 * post-probe (dry-run 후 전부 ABSENT 이어야 PASS):
 *   - reservations.inflow_channel / check_ins.inflow_channel
 *   - customers.first_inflow_channel / first_inflow_at / first_inflow_source_ref
 *   - relation public.system_codes / public.code_availability
 *   - proc public.get_inflow_channels
 *
 * 실행: (repo root) node supabase/migrations/20260801230000_foot_inflow_channel_intake_lane.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun, columnAbsent, regclassAbsent, procAbsent } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260801230000_foot_inflow_channel_intake_lane.sql');

runDryrun({
  upPath: UP,
  assertAbsent: [
    columnAbsent('reservations', 'inflow_channel'),
    columnAbsent('check_ins', 'inflow_channel'),
    columnAbsent('customers', 'first_inflow_channel'),
    columnAbsent('customers', 'first_inflow_at'),
    columnAbsent('customers', 'first_inflow_source_ref'),
    regclassAbsent('public.system_codes'),
    regclassAbsent('public.code_availability'),
    procAbsent('get_inflow_channels'),
  ],
  passNote: '(dual-anchor 5컬럼 + system_codes/code_availability 신규테이블 + get_inflow_channels RPC 무영속 검증)',
}).catch((e) => { console.error(e); process.exit(1); });
