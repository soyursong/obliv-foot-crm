// No-persistence dry-run — T-20260810-foot-TESTACCT-CLEANUP-8ACCT Leg A.
// dryrun_lib 3요소(strip txn-control · plpgsql exception-rollback · post-probe absent).
// post-probe: 19 _arch_* 테이블 prod 부재(CREATE 롤백) + customers 6행 잔존(DELETE 롤백).
import { runDryrun, regclassAbsent } from '../../scripts/dryrun_lib.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const upPath = join(__dirname, '20260810220000_foot_testacct8_legA_cleanup.sql');

const ARCH = ['customers','reservations','packages','check_ins','assignment_actions','chart_treatment_requests',
 'check_in_room_logs','check_in_services','customer_reservation_memos','customer_treatment_memos','form_submissions',
 'health_q_results','health_q_tokens','reservation_logs','reservation_memo_history','status_transitions',
 'package_sessions','notification_logs','phi_access_log'];

const ROOTS = "'21a82994-b231-4bcc-94ff-dd9e6c3a4951','e72022d0-7cf5-4f42-b5e3-b5162005b454','c074025b-cd27-443c-93a9-151d6d4214d4','d7faae9b-8e0b-421a-b68b-483ede6834a3','a0f8c846-9f93-47bf-a79e-57d265d989b6','02594dfa-9428-4405-b640-95ab50ad5e5d'";

const assertAbsent = [
  ...ARCH.map(t => regclassAbsent(`public._arch_testacct8_${t}_20260810`)),
  // DELETE 롤백 실측: 6 customers 가 dry-run 후에도 잔존해야 무영속(=TRUE)
  { label: 'customers 6행 잔존(DELETE 롤백)', sql: `SELECT (SELECT count(*) FROM public.customers WHERE id IN (${ROOTS})) = 6 AS absent;` },
];

await runDryrun({ upPath, assertAbsent, passNote: '(archive-first + FK-safe delete, 212 rows, 무영속 확인)' });
