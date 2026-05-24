/**
 * T-20260524-foot-ROOM-NEXTDAY-STAFF
 * daily_room_status: disabled_by 컬럼 + date CHECK + staff RLS 정책 교체
 * Supabase Management API (SUPABASE_ACCESS_TOKEN) 경유
 *
 * 실행: node scripts/apply_20260524030000_nextday_staff.mjs
 */

const PROJECT_ID = 'rxlomoozakkjesdqjtvd';
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  console.error('❌ SUPABASE_ACCESS_TOKEN 환경변수 필요');
  process.exit(1);
}

async function runSQL(sql, label) {
  const resp = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  const text = await resp.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!resp.ok) {
    // 이미 존재 = idempotent OK
    const msg = typeof body === 'object' ? (body.message ?? '') : String(body);
    if (msg.includes('already exists') || msg.includes('does not exist')) {
      console.log(`✅ ${label}: 이미 반영 (idempotent OK)`);
      return;
    }
    throw new Error(`${label} 실패 (${resp.status}): ${JSON.stringify(body).slice(0, 300)}`);
  }
  console.log(`✅ ${label}: OK`);
}

console.log('🚀 T-20260524-foot-ROOM-NEXTDAY-STAFF DB 마이그레이션 시작');

try {
  // Step 1: disabled_by 컬럼 추가 (AC-6)
  await runSQL(
    `ALTER TABLE daily_room_status ADD COLUMN IF NOT EXISTS disabled_by UUID REFERENCES staff(id) ON DELETE SET NULL`,
    'Step 1: disabled_by 컬럼 추가',
  );

  await runSQL(
    `COMMENT ON COLUMN daily_room_status.disabled_by IS 'T-20260524-foot-ROOM-NEXTDAY-STAFF AC-6: 방 비활성화 설정자 staff.id'`,
    'Step 1b: disabled_by 컬럼 코멘트',
  );

  // Step 2: date <= CURRENT_DATE+1 CHECK (AC-2)
  await runSQL(
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='daily_room_status'::regclass AND conname='daily_room_status_date_max_nextday') THEN ALTER TABLE daily_room_status ADD CONSTRAINT daily_room_status_date_max_nextday CHECK (date <= CURRENT_DATE + 1); END IF; END$$`,
    'Step 2: date CHECK 제약 (D+1 최대)',
  );

  // Step 3a: 기존 admin_all 정책 제거
  await runSQL(
    `DROP POLICY IF EXISTS daily_room_status_admin_all ON daily_room_status`,
    'Step 3a: 기존 admin_all 정책 제거',
  );

  // Step 3b: admin/manager 정책 신규 생성 (idempotent)
  await runSQL(
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='daily_room_status' AND policyname='daily_room_status_admin_manager_write') THEN CREATE POLICY daily_room_status_admin_manager_write ON daily_room_status FOR ALL TO authenticated USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager()); END IF; END$$`,
    'Step 3b: admin/manager 정책 생성',
  );

  // Step 3c: staff 전용 정책
  await runSQL(
    `DROP POLICY IF EXISTS daily_room_status_staff_own_write ON daily_room_status`,
    'Step 3c-1: 기존 staff 정책 제거',
  );

  await runSQL(
    `CREATE POLICY daily_room_status_staff_own_write ON daily_room_status FOR ALL TO authenticated USING (is_approved_user() AND current_user_role() = 'staff' AND EXISTS (SELECT 1 FROM room_assignments ra WHERE ra.clinic_id = daily_room_status.clinic_id AND ra.room_name = daily_room_status.room_name AND ra.staff_id = current_staff_id())) WITH CHECK (is_approved_user() AND current_user_role() = 'staff' AND EXISTS (SELECT 1 FROM room_assignments ra WHERE ra.clinic_id = daily_room_status.clinic_id AND ra.room_name = daily_room_status.room_name AND ra.staff_id = current_staff_id()))`,
    'Step 3c-2: staff 전용 정책 생성',
  );

  // Step 4: 인덱스
  await runSQL(
    `CREATE INDEX IF NOT EXISTS daily_room_status_disabled_by_idx ON daily_room_status (clinic_id, date DESC, disabled_by) WHERE disabled_by IS NOT NULL`,
    'Step 4: disabled_by 인덱스',
  );

  // 검증
  console.log('\n🔍 검증 중...');
  const resp = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `SELECT column_name FROM information_schema.columns WHERE table_name='daily_room_status' AND column_name='disabled_by'`,
      }),
    },
  );
  const colData = await resp.json();
  console.log('disabled_by 컬럼:', colData?.length > 0 || colData?.[0] ? '존재 ✅' : '없음 ❌', JSON.stringify(colData).slice(0, 100));

  const resp2 = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='daily_room_status' ORDER BY policyname`,
      }),
    },
  );
  const policyData = await resp2.json();
  console.log('RLS 정책:', JSON.stringify(policyData));

} catch (err) {
  console.error('❌ 마이그레이션 오류:', err.message);
  process.exit(1);
}

console.log('\n🏁 마이그레이션 완료');
