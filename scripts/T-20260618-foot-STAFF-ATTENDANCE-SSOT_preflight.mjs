/**
 * T-20260618-foot-STAFF-ATTENDANCE-SSOT-CRM — PROD apply 직전 preflight (read-only)
 * DEPLOY-GO MSG-20260718-012818-3rbk (supervisor DDL-diff GO, commit eb59fe60).
 * 목적: apply 前 prod 실재 재확인 — 대상 오브젝트 ABSENT + FK 대상/의존 컨벤션 PRESENT.
 * usage: node scripts/T-20260618-foot-STAFF-ATTENDANCE-SSOT_preflight.mjs
 */
import { query } from './lib/foot_migration_ledger.mjs';

const scalar = async (sql) => {
  const rows = await query(sql);
  const r = (Array.isArray(rows) ? rows : [])[0] || {};
  return r[Object.keys(r)[0]];
};

const nowKst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';
console.log(`── PREFLIGHT (read-only) — ${nowKst()} ──\n`);

const checks = {};
checks.staff_attendance_absent   = await scalar("SELECT to_regclass('public.staff_attendance') AS v;");
checks.trigger_fn_absent         = await scalar("SELECT count(*)::int AS n FROM pg_proc WHERE proname='trigger_attendance_sync';");
checks.cron_job_absent           = await scalar("SELECT count(*)::int AS n FROM cron.job WHERE jobname='foot-attendance-sync';");
checks.clinics_present           = await scalar("SELECT to_regclass('public.clinics') AS v;");
checks.staff_present             = await scalar("SELECT to_regclass('public.staff') AS v;");
checks.user_profiles_present     = await scalar("SELECT to_regclass('public.user_profiles') AS v;");
checks.get_vault_secret_present  = await scalar("SELECT count(*)::int AS n FROM pg_proc WHERE proname='get_vault_secret';");
checks.net_http_post_present     = await scalar("SELECT count(*)::int AS n FROM pg_proc WHERE proname='http_post' AND pronamespace='net'::regnamespace;");
checks.pg_cron_ext              = await scalar("SELECT count(*)::int AS n FROM pg_extension WHERE extname='pg_cron';");
checks.gen_random_uuid          = await scalar("SELECT count(*)::int AS n FROM pg_proc WHERE proname='gen_random_uuid';");

// FK 참조 컬럼 실재 (staff.id, clinics.id, user_profiles.role/active/approved/clinic_id/id)
checks.up_cols = await scalar(`SELECT string_agg(column_name, ',' ORDER BY column_name) AS v
  FROM information_schema.columns
  WHERE table_name='user_profiles' AND column_name IN ('id','clinic_id','active','approved','role');`);

// vault 시크릿 존재 여부(cron worker 의존)
checks.vault_supabase_url = await scalar("SELECT (public.get_vault_secret('supabase_project_url') IS NOT NULL) AS v;").catch(e => `ERR ${e.message}`);
checks.vault_cron_secret  = await scalar("SELECT (public.get_vault_secret('internal_cron_secret') IS NOT NULL) AS v;").catch(e => `ERR ${e.message}`);

// clinic 마스터 (FOOT_CLINIC_ID 확정용)
const clinics = await query("SELECT id, slug, name FROM public.clinics ORDER BY created_at LIMIT 5;");
const staffActive = await scalar("SELECT count(*)::int AS n FROM public.staff WHERE active=true;");

console.log(JSON.stringify(checks, null, 2));
console.log('\nclinics:', JSON.stringify(clinics));
console.log('staff active:', staffActive);

const pass =
  checks.staff_attendance_absent == null &&
  checks.trigger_fn_absent === 0 &&
  checks.cron_job_absent === 0 &&
  checks.clinics_present && checks.staff_present && checks.user_profiles_present &&
  checks.get_vault_secret_present > 0 && checks.net_http_post_present > 0 &&
  checks.pg_cron_ext > 0 && checks.gen_random_uuid > 0 &&
  (checks.up_cols || '').split(',').length === 5;

console.log(`\n── PREFLIGHT ${pass ? 'PASS ✅ (apply 진행 가능)' : 'FAIL ⛔ (전제 붕괴 — apply 보류)'} ──`);
process.exit(pass ? 0 : 3);
