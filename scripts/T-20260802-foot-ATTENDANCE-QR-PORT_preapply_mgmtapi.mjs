/**
 * T-20260802-foot-ATTENDANCE-QR-PORT — PRE-APPLY read-only checks (Management API 경로)
 *   prod DB_PASSWORD 부재 → 직접-pg dryrun 러너 실행 불가. canonical apply 경로(Management API,
 *   foot_migration_ledger.mjs)와 동일한 인증컨텍스트(SUPABASE_ACCESS_TOKEN=postgres role)로 read-only 증거 수집.
 *   여기서는 write 0 (전부 SELECT). apply 는 별도 단계.
 *
 * 수집:
 *   1. ledger 대조 — schema_migrations 에 20260802180000 미기록 확인 (mig_ledger_check)
 *   2. BEFORE introspection — attendance 4테이블·컬럼 부재 + staff_attendance status 분포 (mig_dryrun BEFORE)
 *   3. C19 pre-apply — get_vault_secret 현행 md5(prosrc) + 화이트리스트 baseline 확인 (fail-closed 판정)
 */
import { query, PROJ_REF } from './lib/foot_migration_ledger.mjs';

const line = (s='') => console.log(s);
const rows = (r) => (Array.isArray(r) ? r : (r?.rows ?? r ?? []));
async function Q(label, sql) {
  const r = await query(sql);
  const rr = rows(r);
  line(`\n=== ${label} (${rr.length} rows) ===`);
  console.table(rr);
  return rr;
}

line(`PRE-APPLY read-only (Management API) — ref ${PROJ_REF}  ${new Date().toISOString()}`);

// 1) ledger 대조
await Q('1. ledger: 20260802180000 미기록 확인 (present=false 여야)',
  `SELECT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20260802180000') AS present,
          (SELECT max(version) FROM supabase_migrations.schema_migrations) AS max_version,
          (SELECT count(*) FROM supabase_migrations.schema_migrations) AS ledger_count`);

// 2) BEFORE introspection
await Q('2a. BEFORE: attendance 4테이블 부재(전부 null=ADDITIVE 전제)',
  `SELECT to_regclass('public.attendance_otp')    AS otp,
          to_regclass('public.attendance_punch')  AS punch,
          to_regclass('public.attendance_audit')  AS audit,
          to_regclass('public.attendance_device') AS device`);
await Q('2b. BEFORE: ADDITIVE 컬럼 부재 (전부 0 이어야)',
  `SELECT
     (SELECT count(*) FROM information_schema.columns WHERE table_name='staff' AND column_name='phone') AS staff_phone,
     (SELECT count(*) FROM information_schema.columns WHERE table_name='staff_attendance' AND column_name='scheduled_start_at') AS sched_start,
     (SELECT count(*) FROM information_schema.columns WHERE table_name='staff_attendance' AND column_name='scheduled_end_at') AS sched_end,
     (SELECT count(*) FROM information_schema.columns WHERE table_name='clinics' AND column_name='attendance_late_grace_min') AS grace,
     (SELECT count(*) FROM information_schema.columns WHERE table_name='clinics' AND column_name='attendance_absent_cutoff') AS cutoff`);
await Q('2c. BEFORE: FK 대상 + 의존 함수 존재',
  `SELECT to_regclass('public.clinics') AS clinics, to_regclass('public.staff') AS staff,
          to_regclass('public.user_profiles') AS user_profiles, to_regclass('public.staff_attendance') AS staff_attendance,
          (SELECT count(*) FROM pg_proc WHERE proname='normalize_phone') AS normalize_phone,
          (SELECT count(*) FROM pg_proc WHERE proname='get_vault_secret') AS get_vault_secret`);
await Q('2d. BEFORE: staff_attendance status 분포 (로스터 의미)',
  `SELECT status, count(*) AS n FROM public.staff_attendance GROUP BY status ORDER BY 2 DESC`);

// 3) C19 pre-apply — get_vault_secret 현행 md5(prosrc) + baseline 화이트리스트
await Q('3a. C19 pre: get_vault_secret 현행 md5(prosrc) + 화이트리스트 토큰 실측',
  `SELECT md5(p.prosrc) AS prosrc_md5,
          length(p.prosrc) AS prosrc_len,
          (p.prosrc ~ 'solapi_')        AS has_solapi,
          (p.prosrc ~ 'internal_cron_') AS has_internal_cron,
          (p.prosrc ~ 'supabase_')      AS has_supabase,
          (p.prosrc ~ 'attendance_')    AS has_attendance_already,
          p.provolatile, p.prosecdef
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='get_vault_secret'`);
await Q('3b. C19 pre: get_vault_secret prosrc SIMILAR TO 라인 (OOB 토큰 육안검증)',
  `SELECT regexp_replace(
            (SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='get_vault_secret'),
            '.*(NOT SIMILAR TO[^;]+);.*', '\\1', 's') AS similar_to_clause`);

line('\nPRE-APPLY read-only 완료.');
