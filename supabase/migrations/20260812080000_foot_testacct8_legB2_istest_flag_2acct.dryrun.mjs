// No-persistence dry-run — T-20260810-foot-TESTACCT-CLEANUP-8ACCT Leg B 2차.
// dryrun_lib 3요소(strip txn-control · plpgsql exception-rollback · post-probe absent).
// post-probe: flag UPDATE 롤백 실측 — 2 target 행이 dry-run 후에도 is_test=false 여야 무영속(=absent TRUE).
import { runDryrun } from '../../scripts/dryrun_lib.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const upPath = join(__dirname, '20260812080000_foot_testacct8_legB2_istest_flag_2acct.sql');

const TARGETS = "'e72022d0-7cf5-4f42-b5e3-b5162005b454','66c08e48-c708-4e50-963d-aaa56b27d9ea'";

const assertAbsent = [
  // 무영속 실측: dry-run 후 2 target 행이 여전히 is_test≠true (UPDATE 롤백) → absent=TRUE
  { label: 'legB2 flag 무영속(2행 여전히 is_test false)',
    sql: `SELECT (SELECT count(*) FROM public.customers
                   WHERE COALESCE(is_test,false)=true AND id IN (${TARGETS})) = 0 AS absent;` },
  // KEEP guard 상시 invariant: 박민석 본계정은 절대 flag 안 됨(dry-run 중에도 후에도)
  { label: 'KEEP 본계정(F-4790) 무오염',
    sql: `SELECT (SELECT count(*) FROM public.customers
                   WHERE COALESCE(is_test,false)=true
                     AND id = '1c61bad2-ad49-4e7d-92ae-2d132aae95cb'::uuid) = 0 AS absent;` },
];

await runDryrun({ upPath, assertAbsent, passNote: '(flag-only UPDATE 2행 freeze-set, 무영속 확인)' });
