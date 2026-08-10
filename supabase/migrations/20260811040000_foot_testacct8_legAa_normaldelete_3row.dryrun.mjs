// No-persistence dry-run — T-20260810-foot-TESTACCT-CLEANUP-8ACCT Leg A-(a) 정상삭제 3행.
// dryrun_lib 3요소(strip txn-control · plpgsql exception-rollback · post-probe absent).
// post-probe: 17 _arch_aa_* 테이블 prod 부재(CREATE 롤백) + customers 3행 잔존(DELETE 롤백).
import { runDryrun, regclassAbsent } from '../../scripts/dryrun_lib.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const upPath = join(__dirname, '20260811040000_foot_testacct8_legAa_normaldelete_3row.sql');

const ARCH = ['customers','reservations','packages','check_ins','assignment_actions','chart_treatment_requests',
 'check_in_room_logs','check_in_services','customer_treatment_memos','health_q_results','health_q_tokens',
 'reservation_logs','reservation_memo_history','status_transitions','package_sessions','notification_logs','phi_access_log'];

const ROOTS = "'a0f8c846-9f93-47bf-a79e-57d265d989b6','02594dfa-9428-4405-b640-95ab50ad5e5d','c074025b-cd27-443c-93a9-151d6d4214d4'";

const assertAbsent = [
  ...ARCH.map(t => regclassAbsent(`public._arch_testacct8_aa_${t}_20260811`)),
  // DELETE 롤백 실측: 3 customers 가 dry-run 후에도 잔존해야 무영속(=TRUE)
  { label: 'customers 3행 잔존(DELETE 롤백)', sql: `SELECT (SELECT count(*) FROM public.customers WHERE id IN (${ROOTS})) = 3 AS absent;` },
];

await runDryrun({ upPath, assertAbsent, passNote: '(정상삭제 archive-first + FK-safe delete, 80 rows, form_submissions 무접점, 무영속)' });
