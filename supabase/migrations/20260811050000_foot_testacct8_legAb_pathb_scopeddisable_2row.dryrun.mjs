// No-persistence dry-run — T-20260810-foot-TESTACCT-CLEANUP-8ACCT Leg A-(b) Path-B 물리삭제 2행.
// dryrun_lib 3요소(strip txn-control · plpgsql exception-rollback · post-probe absent).
// ★ 이 dry-run 이 검증하는 것: scoped DISABLE→DELETE(fs 2행)→ENABLE 가 retention-guard 차단 없이 통과함(Path-A는 blanket 차단).
// post-probe: 17 _arch_ab_* prod 부재(CREATE 롤백) + customers 2행 잔존(DELETE 롤백) + fs 2행 잔존 + tgenabled 무변('O').
import { runDryrun, regclassAbsent } from '../../scripts/dryrun_lib.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const upPath = join(__dirname, '20260811050000_foot_testacct8_legAb_pathb_scopeddisable_2row.sql');

const ARCH = ['customers','reservations','packages','check_ins','assignment_actions','chart_treatment_requests',
 'check_in_room_logs','check_in_services','customer_treatment_memos','form_submissions','health_q_results',
 'health_q_tokens','reservation_logs','reservation_memo_history','status_transitions','notification_logs','phi_access_log'];

const ROOTS = "'21a82994-b231-4bcc-94ff-dd9e6c3a4951','d7faae9b-8e0b-421a-b68b-483ede6834a3'";
const FS2 = "'755ac489-a262-48a8-bad0-2f03142c992a','b0edd82a-0d86-4a80-af21-04391d0f1b92'";

const assertAbsent = [
  ...ARCH.map(t => regclassAbsent(`public._arch_testacct8_ab_${t}_20260811`)),
  // DELETE 롤백 실측: 2 customers · fs 2행 잔존해야 무영속(=TRUE)
  { label: 'customers 2행 잔존(DELETE 롤백)', sql: `SELECT (SELECT count(*) FROM public.customers WHERE id IN (${ROOTS})) = 2 AS absent;` },
  { label: 'form_submissions 2행 잔존(scoped purge 롤백)', sql: `SELECT (SELECT count(*) FROM public.form_submissions WHERE id IN (${FS2})) = 2 AS absent;` },
  // retention 트리거 재활성 무변('O') = DISABLE 누출 없음
  { label: 'trg_form_submissions_published_immutable tgenabled=O(무누출)', sql: `SELECT (SELECT t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname='form_submissions' AND t.tgname='trg_form_submissions_published_immutable') = 'O' AS absent;` },
];

await runDryrun({ upPath, assertAbsent, passNote: '(Path-B scoped DISABLE→DELETE(fs 2)→ENABLE, 91 rows, tgenabled 무누출, 무영속)' });
