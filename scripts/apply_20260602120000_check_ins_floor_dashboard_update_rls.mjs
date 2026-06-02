/**
 * T-20260602-foot-DASH-CUSTMOVE-STAFF-RESET
 * 직원(비-admin) 대시보드 고객 이동 저장 차단 해소 — floor 운영 role UPDATE 정책 ADD.
 *
 * ⚠️ 운영 DB 적용은 supervisor 승인 게이트(GO_WARN, 보안 민감 RLS 변경).
 *    dev-foot은 본 스크립트를 "실행하지 않고" 생성만 한다. supervisor가 QA 후 직접 실행.
 *
 * 적용:   node scripts/apply_20260602120000_check_ins_floor_dashboard_update_rls.mjs
 * 롤백:   supabase/migrations/20260602120000_check_ins_floor_dashboard_update_rls.rollback.sql
 *
 * 안전성:
 *   - 추가형 PERMISSIVE 정책(OR 결합) → admin/공간배정 등 기존 경로 회귀 없음(AC-5)
 *   - clinic_id = current_user_clinic_id() 강제 → 타 clinic 이동 불가(AC-3)
 *   - TO authenticated + is_approved_user() → anon/public 쓰기 신설 없음(AC-3)
 *   - DROP POLICY IF EXISTS 선행 → 재적용 안전(idempotent)
 */
import pg from 'pg';
const { Client } = pg;

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: 'bQpgC6tYfXhp@Hr',
  ssl: { rejectUnauthorized: false },
});

console.log('🚀 check_ins_floor_dashboard_update RLS 적용 (T-20260602-foot-DASH-CUSTMOVE-STAFF-RESET)');

try {
  await client.connect();
  console.log('✅ DB 연결 성공');

  await client.query(`
    BEGIN;

    DROP POLICY IF EXISTS check_ins_floor_dashboard_update ON check_ins;

    CREATE POLICY check_ins_floor_dashboard_update ON check_ins FOR UPDATE TO authenticated
      USING (
        is_approved_user()
        AND current_user_role() IN ('consultant','coordinator','therapist','technician')
        AND clinic_id = current_user_clinic_id()
      )
      WITH CHECK (
        is_approved_user()
        AND current_user_role() IN ('consultant','coordinator','therapist','technician')
        AND clinic_id = current_user_clinic_id()
      );

    COMMIT;
  `);
  console.log('✅ 정책 생성/재적용 완료');

  // 검증
  const { rows } = await client.query(`
    SELECT policyname, cmd, permissive
    FROM pg_policies
    WHERE tablename = 'check_ins' AND policyname = 'check_ins_floor_dashboard_update';
  `);
  console.log('🔎 검증:', JSON.stringify(rows));
  if (rows.length !== 1) {
    throw new Error('정책이 적용되지 않음 — 검증 실패');
  }
} catch (err) {
  console.error('❌ 오류:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
  console.log('🏁 완료');
}
