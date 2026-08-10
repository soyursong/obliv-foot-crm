// No-persistence dry-run — T-20260810-foot-TESTACCT-CLEANUP-8ACCT Leg B 2차 is_test flag 2건.
// dryrun_lib 3요소(strip txn-control · plpgsql exception-rollback · post-probe absent).
// 인프라(is_test 컬럼·v_daily_revenue)는 旣 applied(01:08) → 본 dry-run 은 flag UPDATE 무영속만 검증.
// post-probe: 대상 2건(F-4427·F-4445)이 dry-run 후에도 is_test=false 잔존(UPDATE 롤백) + 본계정 F-4790 false 불변.
import { runDryrun } from '../../scripts/dryrun_lib.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const upPath = join(__dirname, '20260811060000_foot_testacct8_legB_istest_flag_2row.sql');

const TARGETS = "'e72022d0-7cf5-4f42-b5e3-b5162005b454','66c08e48-c708-4e50-963d-aaa56b27d9ea'";

const assertAbsent = [
  // UPDATE 롤백 실측: 대상 2건이 dry-run 후에도 is_test=true 가 아니어야(=여전히 false·미flag) 무영속(=TRUE)
  { label: 'F-4427·F-4445 is_test 미영속(flag 롤백)', sql: `SELECT (SELECT count(*) FROM public.customers WHERE id IN (${TARGETS}) AND is_test = true) = 0 AS absent;` },
  // 본계정 F-4790 불변(false)
  { label: '박민석 본계정 F-4790 is_test=false 불변', sql: `SELECT (SELECT count(*) FROM public.customers WHERE id = '1c61bad2-ad49-4e7d-92ae-2d132aae95cb' AND is_test = true) = 0 AS absent;` },
  // is_test=true 전체는 1차 3건 그대로(dry-run 미영속 → 2건 추가 안 됨)
  { label: 'is_test=true 전체 = 3(1차분·미영속)', sql: `SELECT (SELECT count(*) FROM public.customers WHERE is_test = true) = 3 AS absent;` },
];

await runDryrun({ upPath, assertAbsent, passNote: '(Leg B 2차 flag UPDATE 2건, id whitelist, 무영속·본계정 무접촉)' });
