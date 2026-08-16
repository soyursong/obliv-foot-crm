/**
 * DRY-RUN (No-Persistence): T-20260814-foot-STAFF-DEACTIVATE-DELETE-SPLIT
 *   20260814170000_foot_staff_soft_delete.sql
 *   (staff.deleted_at/deleted_by/deleted_reason ADD COLUMN + idx_staff_active_not_deleted partial index)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip(top-level BEGIN;/COMMIT; 제거, sentinel-bypass 차단)
 *   ② plpgsql exception-handler(DO..EXECUTE..EXCEPTION) 무영속 실행
 *   ③ post-probe assertAbsent — dry-run 후 신규 컬럼/인덱스 미영속 실측(INV-3).
 *
 * 실행: (repo root) node supabase/migrations/20260814170000_foot_staff_soft_delete.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260814170000_foot_staff_soft_delete.sql');

// 신규 3컬럼 미영속 실측 — dry-run 후 부재 = TRUE(absent).
const colsAbsent = {
  label: 'staff.deleted_at/deleted_by/deleted_reason columns (non-persistent)',
  sql: `SELECT NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'staff'
             AND column_name IN ('deleted_at','deleted_by','deleted_reason')
        ) AS absent;`,
};

// 신규 partial index 미영속 실측.
const idxAbsent = {
  label: 'idx_staff_active_not_deleted partial index (non-persistent)',
  sql: `SELECT NOT EXISTS (
          SELECT 1 FROM pg_indexes
           WHERE schemaname = 'public' AND tablename = 'staff'
             AND indexname = 'idx_staff_active_not_deleted'
        ) AS absent;`,
};

runDryrun({
  upPath: UP,
  assertAbsent: [ colsAbsent, idxAbsent ],
  passNote: '(staff soft-delete 3컬럼 + 활성행 partial index ADDITIVE 무영속 검증 — dry-run 후 부재)',
}).catch((e) => { console.error(e); process.exit(1); });
