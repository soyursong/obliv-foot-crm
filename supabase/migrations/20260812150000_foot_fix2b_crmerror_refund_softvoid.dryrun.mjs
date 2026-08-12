// No-persistence dry-run — T-20260811-foot-CONSULTANT-REVENUE-FIX2B-SOFTVOID.
// dryrun_lib 3요소(strip txn-control · plpgsql exception-rollback · post-probe).
//
// up.sql = 순수 DML(DO 블록 UPDATE, 트랜잭션 제어문 없음). harness 가 sentinel RAISE 로
// subtxn 을 강제 롤백 → 무영속. 정상경로에서 up.sql 의 rows-affected 가드/post-assert 는
// 3행 매칭(fresh prod=active 3)으로 통과하고, 이후 sentinel 이 전부 롤백한다.
//
// post-probe(무영속 실증): dry-run 후 3 대상행이 여전히 status='active' 여야 한다
//   (soft-void 가 prod 에 영속되지 않았음). 하나라도 cancelled 로 남으면 persistence-leak FAIL.
import { runDryrun } from '../../scripts/dryrun_lib.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const upPath = join(__dirname, '20260812150000_foot_fix2b_crmerror_refund_softvoid.sql');

const IDS = "'2dedc31e-109d-46c6-b592-afe25b8d46b0','1799c939-a810-481d-ae41-1d50937e180b','ea1f5000-b48c-4ddd-9faa-23925a27d40f'";

const assertAbsent = [
  {
    label: 'FIX2B 3 대상행 status=active 잔존(soft-void 무영속)',
    sql: `SELECT (SELECT count(*) FROM public.payments WHERE id IN (${IDS}) AND status='active') = 3 AS absent;`,
  },
  {
    label: 'FIX2B cancelled_by 각인 prod 부재(무영속)',
    sql: `SELECT NOT EXISTS(SELECT 1 FROM public.payments WHERE id IN (${IDS}) AND cancelled_by = 'dev-foot:T-20260811-foot-CONSULTANT-REVENUE-FIX2B-SOFTVOID') AS absent;`,
  },
];

await runDryrun({ upPath, assertAbsent, passNote: '(payments 3행 soft-void DML, rows-affected=3 가드 통과, 무영속 확인)' });
