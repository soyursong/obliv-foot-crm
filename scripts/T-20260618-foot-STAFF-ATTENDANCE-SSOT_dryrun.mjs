/**
 * T-20260618-foot-STAFF-ATTENDANCE-SSOT-CRM — staff_attendance 신설 dry-run (READ-ONLY + TX ROLLBACK 시뮬)
 *
 * 목적 (supervisor DDL-diff QA 게이트 증거):
 *   0. 충돌 가드: staff_attendance 테이블이 이미 존재하지 않음(신설 ADDITIVE 전제) 확인.
 *   1. 마이그 SQL 을 TX 안에서 실제 실행 → CREATE TABLE/INDEX/RLS POLICY 4종 성립 확인 → ROLLBACK.
 *   2. 시뮬 TX 안에서 컬럼/제약/정책/인덱스 메타 조회 (DA 권고 모델 일치 검증).
 *   3. FK 대상(clinics, staff, user_profiles) 존재 + 멱등 재실행(IF NOT EXISTS) 무해성 확인.
 *   4. 매핑 전제 데이터: staff 마스터 행수(시트 직원명→staff_id 결정적 매핑 모집단 규모 참고).
 *
 * write 없음 (BEGIN ... ROLLBACK). prod 안전.
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

// 마이그 본문에서 자체 BEGIN;/COMMIT; 제거 → 외부 단일 TX 안에서 실행 후 ROLLBACK(진짜 무커밋).
const MIGRATION = fs.readFileSync(
  new URL('../supabase/migrations/20260618200000_staff_attendance_ssot.sql', import.meta.url),
  'utf8',
).replace(/^\s*BEGIN\s*;\s*$/im, '').replace(/^\s*COMMIT\s*;\s*$/im, '');

await client.connect();
console.log(`DB 연결 (READ-ONLY + TX ROLLBACK)  ${new Date().toISOString()}`);

// 0) 신설 전제 — 테이블 미존재 확인
await q('0. 충돌 가드: staff_attendance 사전 존재 여부 (0이어야 ADDITIVE)',
  `SELECT to_regclass('public.staff_attendance') AS existing_table`);

// FK 대상 테이블 존재 확인
await q('0b. FK 대상 테이블 존재 (clinics/staff/user_profiles)',
  `SELECT
     to_regclass('public.clinics')       AS clinics,
     to_regclass('public.staff')         AS staff,
     to_regclass('public.user_profiles') AS user_profiles`);

// 매핑 모집단 참고 — staff 마스터 행수(시트 직원명→staff_id 결정적 매핑 대상)
await q('0c. staff 마스터 규모 (sync 매핑 모집단 참고)',
  `SELECT clinic_id, count(*) AS staff_cnt, count(*) FILTER (WHERE active) AS active_cnt
   FROM staff GROUP BY clinic_id ORDER BY staff_cnt DESC`);

// 1) 마이그 시뮬레이션 — 외부 단일 TX(BEGIN ... 마이그 본문 ... 메타조회 ... ROLLBACK). 무커밋.
console.log('\n>>> 외부 TX 시작 (커밋 없음 — 끝에 ROLLBACK)');
try {
  await client.query('BEGIN');

  await client.query(MIGRATION);   // 본문(내부 BEGIN/COMMIT 제거됨) → 외부 TX 안에서 실행
  console.log('✅ 마이그 SQL 실행 성공 (구문/제약/RLS 성립)');

  await q('2a. 생성된 컬럼 (DA 권고 모델 일치 검증)',
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_name='staff_attendance' ORDER BY ordinal_position`);

  await q('2b. CHECK / UNIQUE / FK 제약',
    `SELECT con.conname, pg_get_constraintdef(con.oid) AS def
     FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
     WHERE c.relname='staff_attendance' AND con.contype IN ('c','u','p','f')
     ORDER BY con.contype`);

  await q('2c. RLS 정책 4종 (select/insert/update/delete)',
    `SELECT policyname, cmd FROM pg_policies WHERE tablename='staff_attendance' ORDER BY cmd`);

  await q('2d. 인덱스',
    `SELECT indexname, indexdef FROM pg_indexes WHERE tablename='staff_attendance'`);

  // 3) 멱등 재실행 무해성 — 한 번 더 실행 시 에러 없이 통과(IF NOT EXISTS / DROP POLICY 후 재생성)
  console.log('\n>>> 멱등 재실행 시뮬 (동일 TX)');
  await client.query(MIGRATION);
  console.log('✅ 멱등 재실행 무해(IF NOT EXISTS / DROP POLICY 재생성)');

} finally {
  await client.query('ROLLBACK');
  console.log('\n🧹 ROLLBACK 완료 — prod 무변경(커밋 없음)');
}

// 4) 원복 확인
await q('4. 원복 확인 (다시 NULL 이어야 함)',
  `SELECT to_regclass('public.staff_attendance') AS should_be_null`);

await client.end();
console.log('\n완료. prod 무변경(외부 TX ROLLBACK).');
