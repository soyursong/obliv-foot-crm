/**
 * DRY-RUN (No-Persistence): T-20260801-foot-INFLOW-KIOSK-SELFCHECKIN-COVERAGE
 *   20260807120000_foot_inflow_kiosk_selfcheckin_candidate.sql
 *   (candidate hint 컬럼 check_ins.inflow_channel_self_reported nullable ADDITIVE
 *    + fn_complete_prescreen_checklist CREATE OR REPLACE = 로직 승계 + candidate write 1줄)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip(top-level BEGIN/COMMIT 없음 — sentinel-bypass 차단)
 *   ② plpgsql exception-handler(DO..EXECUTE..EXCEPTION) 무영속 실행
 *   ③ post-probe assertAbsent — dry-run 후 신규 컬럼 prod 부재 실측(INV-3).
 *   ⚠ up.sql = ADD COLUMN(nullable) + CREATE OR REPLACE FUNCTION → 전부 txn-safe/가역 → 무영속 적격
 *     (CONCURRENTLY·enum ADD VALUE 등 non-txn DDL 없음).
 *   ※ fn_complete_prescreen_checklist 는 CREATE OR REPLACE(기존 존재) → 무영속 롤백 시 기존 정의 복원.
 *      컬럼(신규)만 post-probe ABSENT 로 검증(함수는 원자 REPLACE·기존 시그니처 동일).
 *
 * post-probe (dry-run 후 ABSENT 이어야 PASS):
 *   - check_ins.inflow_channel_self_reported
 *
 * 실행: (repo root) node supabase/migrations/20260807120000_foot_inflow_kiosk_selfcheckin_candidate.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun, columnAbsent } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260807120000_foot_inflow_kiosk_selfcheckin_candidate.sql');

runDryrun({
  upPath: UP,
  assertAbsent: [
    columnAbsent('check_ins', 'inflow_channel_self_reported'),
  ],
  passNote: '(candidate hint 컬럼 check_ins.inflow_channel_self_reported 무영속 검증 · canonical inflow_channel 무접점)',
}).catch((e) => { console.error(e); process.exit(1); });
