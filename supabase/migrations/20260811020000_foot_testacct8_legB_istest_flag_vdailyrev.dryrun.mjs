// No-persistence dry-run — T-20260810-foot-TESTACCT-CLEANUP-8ACCT Leg B.
// dryrun_lib 3요소(strip txn-control · plpgsql exception-rollback · post-probe absent).
// 표준: agents/docs/migration_dryrun_no_persistence_standard.md
//
// post-probe(무영속 실증): dry-run 후 아래가 전부 롤백되어 있어야 PASS.
//   1) customers.is_test 컬럼 부재(ADD COLUMN 롤백) — 컬럼 부재면 flag UPDATE 도 자동 롤백됨.
//   2) v_daily_revenue 정의가 is_test 를 참조하지 않음(CREATE OR REPLACE VIEW 롤백 = 20260718 base).
import { runDryrun } from '../../scripts/dryrun_lib.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const upPath = join(__dirname, '20260811020000_foot_testacct8_legB_istest_flag_vdailyrev.sql');

const assertAbsent = [
  {
    label: 'customers.is_test 컬럼 부재(ADD COLUMN 롤백 → flag UPDATE 도 무영속)',
    sql: `SELECT NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='customers' AND column_name='is_test'
          ) AS absent;`,
  },
  {
    label: 'v_daily_revenue 정의 is_test 미참조(뷰 재정의 롤백 = 20260718 base)',
    sql: `SELECT position('is_test' IN pg_get_viewdef('public.v_daily_revenue'::regclass, true)) = 0 AS absent;`,
  },
];

await runDryrun({
  upPath,
  assertAbsent,
  passNote: '(ADD COLUMN is_test[nullable default false] + flag 3 whitelist + v_daily_revenue is_test/is_sim 필터, 무영속 확인)',
});
