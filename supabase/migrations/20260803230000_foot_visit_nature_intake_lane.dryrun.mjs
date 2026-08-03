/**
 * DRY-RUN (No-Persistence): T-20260803-foot-VISIT-NATURE-COLUMN-DERIVESEED
 *   20260803230000_foot_visit_nature_intake_lane.sql
 *   (visit_nature 2컬럼 nullable ADDITIVE + system_codes 4코드 시드 + code_availability experience 오버레이
 *    + get_visit_natures RPC. system_codes/code_availability 테이블은 inflow lane 재사용 = IF NOT EXISTS.)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip(top-level BEGIN/COMMIT 없음 — sentinel-bypass 차단)
 *   ② plpgsql exception-handler(DO..EXECUTE..EXCEPTION) 무영속 실행
 *   ③ post-probe assertAbsent — dry-run 후 신규 컬럼/RPC prod 부재 실측(INV-3).
 *   ⚠ up.sql = ADD COLUMN(nullable) + CREATE TABLE IF NOT EXISTS + INSERT ON CONFLICT + INSERT..SELECT
 *     + CREATE OR REPLACE FUNCTION → 전부 txn-safe/가역 → 무영속 dry-run 적격
 *     (CONCURRENTLY·enum ADD VALUE 등 non-txn DDL 없음).
 *
 * post-probe (dry-run 후 신규 컬럼/RPC 는 prod ABSENT 이어야 PASS):
 *   - reservations.visit_nature / check_ins.visit_nature
 *   - proc public.get_visit_natures
 *   ※ system_codes/code_availability 테이블은 inflow lane 로 prod 에 이미 실재 → assertAbsent 대상 아님
 *     (IF NOT EXISTS 재사용, 신규 생성 아님).
 *
 * 실행: (repo root) node supabase/migrations/20260803230000_foot_visit_nature_intake_lane.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun, columnAbsent, procAbsent } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260803230000_foot_visit_nature_intake_lane.sql');

runDryrun({
  upPath: UP,
  assertAbsent: [
    columnAbsent('reservations', 'visit_nature'),
    columnAbsent('check_ins', 'visit_nature'),
    procAbsent('get_visit_natures'),
  ],
  passNote: '(visit_nature 2컬럼 + system_codes 4코드 재사용시드 + experience 오버레이 + get_visit_natures RPC 무영속 검증)',
}).catch((e) => { console.error(e); process.exit(1); });
