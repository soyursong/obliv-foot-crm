/**
 * T-20260520-foot-STAFF-DAILY-READ
 * daily_closings SELECT RLS — staff/part_lead 일마감 열람 권한
 *
 * 실행: SUPABASE_ACCESS_TOKEN=... node scripts/apply_20260521000030_daily_closings_staff_select_rls.mjs
 */

const PROJECT_ID = 'rxlomoozakkjesdqjtvd';
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  console.error('❌ SUPABASE_ACCESS_TOKEN 환경변수 필요');
  process.exit(1);
}

const MIGRATION_SQL = `
-- T-20260520-foot-STAFF-DAILY-READ: daily_closings SELECT RLS — staff/part_lead 일마감 열람 권한

BEGIN;

-- 1. is_floor_staff() 헬퍼 함수 (idempotent CREATE OR REPLACE)
CREATE OR REPLACE FUNCTION is_floor_staff()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_approved_user()
     AND current_user_role() IN ('admin','manager','director','staff','part_lead','tm');
$$;

COMMENT ON FUNCTION is_floor_staff() IS
  'T-20260520-foot-STAFF-PERM-AUDIT 계열: 운영 직원 판정 (admin/manager/director/staff/part_lead/tm). idempotent.';

GRANT EXECUTE ON FUNCTION is_floor_staff() TO authenticated;
REVOKE EXECUTE ON FUNCTION is_floor_staff() FROM anon, public;

-- 2. daily_closings SELECT 정책 — staff/part_lead 추가
DROP POLICY IF EXISTS daily_closings_staff_read ON daily_closings;

CREATE POLICY daily_closings_staff_read ON daily_closings
  FOR SELECT TO authenticated
  USING (is_floor_staff());

COMMENT ON POLICY daily_closings_staff_read ON daily_closings IS
  'T-20260520-foot-STAFF-DAILY-READ: staff/part_lead/tm 일마감 열람 허용. WRITE는 daily_closings_admin_all(admin/manager 전용) 유지.';

COMMIT;
`;

async function query(sql) {
  const resp = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    }
  );
  const result = await resp.json();
  return { ok: resp.ok, result };
}

async function run() {
  console.log('T-20260520-foot-STAFF-DAILY-READ: 마이그레이션 적용 시작');
  console.log('Project:', PROJECT_ID);

  // 1. 마이그레이션 적용
  const { ok, result } = await query(MIGRATION_SQL);
  if (!ok) {
    console.error('❌ 마이그레이션 실패:', JSON.stringify(result, null, 2));
    process.exit(1);
  }
  console.log('✅ 마이그레이션 적용 완료:', JSON.stringify(result));

  // 2. 검증: daily_closings 정책 목록
  console.log('\n검증: daily_closings RLS 정책 목록...');
  const { ok: vOk, result: vResult } = await query(`
    SELECT policyname, cmd, roles
      FROM pg_policies
     WHERE schemaname='public' AND tablename='daily_closings'
     ORDER BY cmd, policyname;
  `);
  if (vOk && Array.isArray(vResult)) {
    console.log('📋 daily_closings 정책 목록:');
    vResult.forEach(p => console.log(`  ${p.policyname} | ${p.cmd} | ${p.roles}`));
    const hasStaffRead = vResult.some(p => p.policyname === 'daily_closings_staff_read');
    console.log(hasStaffRead
      ? '✅ daily_closings_staff_read 정책 확인됨'
      : '❌ daily_closings_staff_read 미확인 — 수동 확인 필요'
    );
  } else {
    console.log('검증 쿼리 실패:', JSON.stringify(vResult));
  }

  // 3. 검증: is_floor_staff() 함수
  console.log('\n검증: is_floor_staff() 함수 존재 확인...');
  const { ok: fOk, result: fResult } = await query(`
    SELECT proname, prosecdef
      FROM pg_proc
     WHERE proname = 'is_floor_staff'
       AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname='public');
  `);
  if (fOk && Array.isArray(fResult) && fResult.length > 0) {
    console.log(`✅ is_floor_staff() 확인됨. SECURITY DEFINER: ${fResult[0].prosecdef}`);
  } else {
    console.log('❌ is_floor_staff() 미확인:', JSON.stringify(fResult));
  }
}

run().catch(e => {
  console.error('❌ 오류:', e);
  process.exit(1);
});
