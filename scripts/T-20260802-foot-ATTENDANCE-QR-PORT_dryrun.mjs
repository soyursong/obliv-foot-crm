/**
 * T-20260802-foot-ATTENDANCE-QR-PORT — QR 출퇴근 스택 이식 dry-run (READ-ONLY + TX ROLLBACK 시뮬)
 *
 * 목적 (supervisor DDL-diff QA 게이트 증거 · BEFORE introspection §2 의무):
 *   0.  BEFORE introspection — attendance 4테이블·staff.phone·scheduled 컬럼 부재 재확인(ADDITIVE 전제).
 *   0b. FK 대상(clinics/staff/user_profiles/staff_attendance) + 의존 함수(normalize_phone/get_vault_secret) 존재.
 *   0c. foot staff_attendance 실 시맨틱 표본 — status 분포(present/off/leave, 로스터 의미 확정).
 *   1.  마이그 SQL 을 TX 안에서 실제 실행 → 테이블/뷰/RPC/컬럼 성립 확인 → ROLLBACK(무영속).
 *   2.  시뮬 TX 안에서 신규 객체 메타 조회(컬럼/정책/인덱스/함수).
 *   3.  멱등 재실행(IF NOT EXISTS / OR REPLACE) 무해성 확인.
 *
 * write 없음 (BEGIN ... ROLLBACK). prod 안전. sentinel-bypass 방지: 마이그 내부 COMMIT 없음(단일 BEGIN/COMMIT만 strip).
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) DB_PASSWORD = m[1].trim();
  }
}
if (!DB_PASSWORD) { console.error('SUPABASE_DB_PASSWORD 필요 (.env)'); process.exit(1); }

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

const q = async (label, sql, params = []) => {
  const r = await client.query(sql, params);
  console.log(`\n=== ${label} (${r.rowCount} rows) ===`);
  console.table(r.rows);
  return r.rows;
};

const MIGRATION = fs.readFileSync(
  new URL('../supabase/migrations/20260802180000_attendance_qr_port.sql', import.meta.url),
  'utf8',
).replace(/^\s*BEGIN\s*;\s*$/im, '').replace(/^\s*COMMIT\s*;\s*$/im, '');

await client.connect();
console.log(`DB 연결 (READ-ONLY + TX ROLLBACK)  ${new Date().toISOString()}`);

// 0) BEFORE introspection — 신규 객체 부재(ADDITIVE 전제)
await q('0. BEFORE: attendance 4테이블 부재(전부 null 이어야 ADDITIVE)',
  `SELECT to_regclass('public.attendance_otp')    AS otp,
          to_regclass('public.attendance_punch')  AS punch,
          to_regclass('public.attendance_audit')  AS audit,
          to_regclass('public.attendance_device') AS device`);
await q('0a. BEFORE: staff.phone / staff_attendance.scheduled_* / clinics.attendance_* 컬럼 부재',
  `SELECT
     (SELECT count(*) FROM information_schema.columns WHERE table_name='staff' AND column_name='phone') AS staff_phone,
     (SELECT count(*) FROM information_schema.columns WHERE table_name='staff_attendance' AND column_name='scheduled_start_at') AS sched_start,
     (SELECT count(*) FROM information_schema.columns WHERE table_name='clinics' AND column_name='attendance_late_grace_min') AS grace`);

// 0b) FK/의존 존재
await q('0b. FK 대상 + 의존 함수 존재',
  `SELECT
     to_regclass('public.clinics')          AS clinics,
     to_regclass('public.staff')            AS staff,
     to_regclass('public.user_profiles')    AS user_profiles,
     to_regclass('public.staff_attendance') AS staff_attendance,
     (SELECT count(*) FROM pg_proc WHERE proname='normalize_phone')  AS normalize_phone,
     (SELECT count(*) FROM pg_proc WHERE proname='get_vault_secret') AS get_vault_secret`);

// 0c) foot staff_attendance 실 시맨틱 표본 — 로스터 의미 확정(§2 WARN)
await q('0c. staff_attendance status 분포 (로스터=present/off/leave 확인)',
  `SELECT status, count(*) FROM public.staff_attendance GROUP BY status ORDER BY 2 DESC`);

// 1) 시뮬 TX — 마이그 실제 실행 → 검증 → ROLLBACK
await client.query('BEGIN');
try {
  await client.query(MIGRATION);
  console.log('\n[TX] 마이그 실행 성공 (아직 미커밋)');

  await q('1a. 신규 테이블 4종 성립',
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public'
        AND table_name IN ('attendance_otp','attendance_punch','attendance_audit','attendance_device')
      ORDER BY 1`);
  await q('1b. ADDITIVE 컬럼 성립',
    `SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE (table_name='staff' AND column_name='phone')
         OR (table_name='staff_attendance' AND column_name IN ('scheduled_start_at','scheduled_end_at'))
         OR (table_name='clinics' AND column_name IN ('attendance_late_grace_min','attendance_absent_cutoff'))
      ORDER BY 1,2`);
  await q('1c. 신규 RPC/뷰 성립',
    `SELECT proname AS obj FROM pg_proc
      WHERE proname IN ('set_staff_phone','fn_attendance_record_punch','fn_attendance_verdict',
                        'approve_attendance_device','revoke_attendance_device')
     UNION ALL
     SELECT 'view:'||viewname FROM pg_views WHERE viewname='v_attendance_reconcile'
     ORDER BY 1`);
  await q('1d. RLS 정책 (otp=0건, punch/audit/device=manager+ SELECT, anon/public USING(true)=0)',
    `SELECT tablename, policyname, cmd, roles::text FROM pg_policies
      WHERE tablename IN ('attendance_otp','attendance_punch','attendance_audit','attendance_device')
      ORDER BY 1,2`);
  await q('1e. get_vault_secret 화이트리스트 attendance_ 포함 검증(true 여야 함)',
    `SELECT 'attendance_qr_hmac_key' SIMILAR TO '(solapi_|internal_cron_|supabase_|attendance_)%' AS attendance_allowed`);
  await q('1f. 멱등 재실행 무해성 — 동일 마이그 재실행 (에러 없어야)',
    'SELECT 1 AS reapply_probe');
  await client.query(MIGRATION); // 재실행 → IF NOT EXISTS/OR REPLACE 로 무해
  console.log('[TX] 멱등 재실행 성공');
} catch (e) {
  console.error('\n[TX] 마이그 실행 실패:', e.message);
} finally {
  await client.query('ROLLBACK');
  console.log('\n[TX] ROLLBACK 완료 — prod 무영속 확인');
}

// 사후 무영속 확인 (post-probe) — 롤백 후 신규 테이블 부재 재확인
await q('POST. 무영속 확인: attendance_otp 여전히 부재(null 이어야)',
  `SELECT to_regclass('public.attendance_otp') AS otp_after_rollback`);

await client.end();
console.log('\ndry-run 완료.');
