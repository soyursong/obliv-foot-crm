/**
 * T-20260524-foot-ROOM-NEXTDAY-STAFF
 * daily_room_status: disabled_by 컬럼 + date CHECK + staff RLS 정책 교체
 * node-pg 직접 연결 방식
 */
import pg from 'pg';
const { Client } = pg;

const client = new Client({
  host: 'aws-0-ap-northeast-2.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: 'bQpgC6tYfXhp@Hr',
  ssl: { rejectUnauthorized: false },
});

console.log('🚀 T-20260524-foot-ROOM-NEXTDAY-STAFF DB 마이그레이션 시작');

try {
  await client.connect();
  console.log('✅ DB 연결 성공');

  // Step 1: disabled_by 컬럼 추가 (AC-6)
  await client.query(`
    ALTER TABLE daily_room_status
      ADD COLUMN IF NOT EXISTS disabled_by UUID REFERENCES staff(id) ON DELETE SET NULL;
  `);
  await client.query(`
    COMMENT ON COLUMN daily_room_status.disabled_by IS
      'T-20260524-foot-ROOM-NEXTDAY-STAFF AC-6: 방 비활성화 설정자 staff.id.';
  `);
  console.log('✅ Step 1: disabled_by 컬럼 추가 완료');

  // Step 2: date <= CURRENT_DATE+1 CHECK (AC-2, idempotent)
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'daily_room_status'::regclass
          AND conname = 'daily_room_status_date_max_nextday'
      ) THEN
        ALTER TABLE daily_room_status
          ADD CONSTRAINT daily_room_status_date_max_nextday
          CHECK (date <= CURRENT_DATE + 1);
      END IF;
    END$$;
  `);
  console.log('✅ Step 2: date CHECK 제약 추가 완료');

  // Step 3a: 기존 admin_all 정책 제거
  await client.query(`DROP POLICY IF EXISTS daily_room_status_admin_all ON daily_room_status;`);
  console.log('✅ Step 3a: 기존 admin_all 정책 제거');

  // Step 3b: admin/manager 정책 (idempotent)
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname='public' AND tablename='daily_room_status'
          AND policyname='daily_room_status_admin_manager_write'
      ) THEN
        CREATE POLICY daily_room_status_admin_manager_write ON daily_room_status
          FOR ALL TO authenticated
          USING (is_admin_or_manager())
          WITH CHECK (is_admin_or_manager());
      END IF;
    END$$;
  `);
  console.log('✅ Step 3b: admin/manager 정책 생성');

  // Step 3c: staff 전용 정책 (idempotent)
  await client.query(`DROP POLICY IF EXISTS daily_room_status_staff_own_write ON daily_room_status;`);
  await client.query(`
    CREATE POLICY daily_room_status_staff_own_write ON daily_room_status
      FOR ALL TO authenticated
      USING (
        is_approved_user()
        AND current_user_role() = 'staff'
        AND EXISTS (
          SELECT 1 FROM room_assignments ra
          WHERE ra.clinic_id = daily_room_status.clinic_id
            AND ra.room_name = daily_room_status.room_name
            AND ra.staff_id = current_staff_id()
        )
      )
      WITH CHECK (
        is_approved_user()
        AND current_user_role() = 'staff'
        AND EXISTS (
          SELECT 1 FROM room_assignments ra
          WHERE ra.clinic_id = daily_room_status.clinic_id
            AND ra.room_name = daily_room_status.room_name
            AND ra.staff_id = current_staff_id()
        )
      );
  `);
  console.log('✅ Step 3c: staff 전용 정책 생성');

  // Step 4: disabled_by 인덱스
  await client.query(`
    CREATE INDEX IF NOT EXISTS daily_room_status_disabled_by_idx
      ON daily_room_status (clinic_id, date DESC, disabled_by)
      WHERE disabled_by IS NOT NULL;
  `);
  console.log('✅ Step 4: disabled_by 인덱스 생성');

  // 검증
  const { rows: cols } = await client.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name='daily_room_status' AND column_name='disabled_by';
  `);
  console.log('🔍 검증 — disabled_by 컬럼:', cols.length > 0 ? '존재 ✅' : '없음 ❌');

  const { rows: policies } = await client.query(`
    SELECT policyname FROM pg_policies
    WHERE schemaname='public' AND tablename='daily_room_status'
    ORDER BY policyname;
  `);
  console.log('🔍 검증 — RLS 정책:', policies.map(r => r.policyname).join(', '));

  const { rows: checks } = await client.query(`
    SELECT conname FROM pg_constraint
    WHERE conrelid='daily_room_status'::regclass AND conname='daily_room_status_date_max_nextday';
  `);
  console.log('🔍 검증 — CHECK 제약:', checks.length > 0 ? '존재 ✅' : '없음 ❌');

} catch (err) {
  console.error('❌ 마이그레이션 오류:', err.message);
  process.exit(1);
} finally {
  await client.end();
}

console.log('🏁 마이그레이션 완료');
