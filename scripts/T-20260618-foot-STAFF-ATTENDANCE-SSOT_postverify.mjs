/**
 * T-20260618-foot-STAFF-ATTENDANCE-SSOT-CRM — POST-DEPLOY CHECKLIST verify (read-only)
 * DEPLOY-GO MSG-20260718-012818-3rbk. 마이그 하단 6항목 evidence.
 */
import { query } from './lib/foot_migration_ledger.mjs';
const nowKst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';
console.log(`── POST-DEPLOY VERIFY — ${nowKst()} ──\n`);

const out = {};
out['1_table']    = await query("SELECT to_regclass('public.staff_attendance') AS v;");
out['1_columns']  = await query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='staff_attendance' ORDER BY ordinal_position;");
out['1_unique']   = await query("SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='public.staff_attendance'::regclass AND contype IN ('u','p','f','c') ORDER BY contype;");
out['1_index']    = await query("SELECT indexname FROM pg_indexes WHERE tablename='staff_attendance' ORDER BY indexname;");
out['1_rls_on']   = await query("SELECT relrowsecurity FROM pg_class WHERE oid='public.staff_attendance'::regclass;");
out['1_policies'] = await query("SELECT policyname, cmd FROM pg_policies WHERE tablename='staff_attendance' ORDER BY policyname;");
out['2_function'] = await query("SELECT proname, prosecdef FROM pg_proc WHERE proname='trigger_attendance_sync';");
out['3_cron']     = await query("SELECT jobname, schedule, active FROM cron.job WHERE jobname='foot-attendance-sync';");

console.log(JSON.stringify(out, null, 2));
