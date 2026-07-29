/**
 * DRY-RUN (No-Persistence): T-20260726-foot-ASSIGN-CONSULTTYPE-DROPDOWN
 *   20260729150000_foot_assign_consult_type.sql
 *   (check_ins 에 assignment_consult_type ADDITIVE nullable 1컬럼 + named CHECK)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip(top-level BEGIN;/COMMIT; 제거, sentinel-bypass 차단)
 *   ② plpgsql exception-handler(DO..EXECUTE..EXCEPTION) 무영속 실행
 *   ③ post-probe assertAbsent — dry-run 후 check_ins 에 신규 컬럼·제약 미영속 실측(INV-3).
 *
 * 실행: (repo root) node supabase/migrations/20260729150000_foot_assign_consult_type.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260729150000_foot_assign_consult_type.sql');

// 신규 컬럼 미영속 실측 — dry-run 후 information_schema.columns 에 부재 = TRUE(absent).
const colAbsent = {
  label: 'assignment_consult_type column on check_ins (non-persistent)',
  sql: `SELECT NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'check_ins'
             AND column_name = 'assignment_consult_type'
        ) AS absent;`,
};

// named CHECK 미영속 실측 — dry-run 후 pg_constraint 에 부재 = TRUE(absent).
const constraintAbsent = {
  label: 'chk_check_ins_assignment_consult_type on check_ins (non-persistent)',
  sql: `SELECT NOT EXISTS (
          SELECT 1 FROM pg_constraint
           WHERE conrelid = 'public.check_ins'::regclass
             AND conname = 'chk_check_ins_assignment_consult_type'
        ) AS absent;`,
};

runDryrun({
  upPath: UP,
  assertAbsent: [ colAbsent, constraintAbsent ],
  passNote: '(check_ins assignment_consult_type 1컬럼 + named CHECK ADDITIVE 무영속 검증 — dry-run 후 부재)',
}).catch((e) => { console.error(e); process.exit(1); });
