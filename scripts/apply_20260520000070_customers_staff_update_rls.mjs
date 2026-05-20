/**
 * T-20260520-foot-STAFF-CUSTOMER-UPDATE
 * customers UPDATE RLS — staff/part_lead 고객 전화·주소 수정 권한 부여
 *
 * 의존성: is_floor_staff() (20260520000060 에서 정의됨)
 * 멱등: DROP IF EXISTS 후 재생성
 *
 * 실행: SUPABASE_ACCESS_TOKEN=... node scripts/apply_20260520000070_customers_staff_update_rls.mjs
 */

const PROJECT_ID = 'rxlomoozakkjesdqjtvd';
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  console.error('❌ SUPABASE_ACCESS_TOKEN 환경변수 필요');
  process.exit(1);
}

const MIGRATION_SQL = `
-- T-20260520-foot-STAFF-CUSTOMER-UPDATE
-- customers UPDATE RLS — staff/part_lead 고객 전화·주소 수정 권한 부여

-- 1. is_floor_staff() 재확인 (idempotent — 20260520000060 에서 이미 생성됨)
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
  'T-20260520-foot-STAFF-CUSTOMER-UPDATE: 운영 직원 판정 (admin/manager/director/staff/part_lead/tm). idempotent.';

GRANT EXECUTE ON FUNCTION is_floor_staff() TO authenticated;
REVOKE EXECUTE ON FUNCTION is_floor_staff() FROM anon, public;

-- 2. customers UPDATE 정책 추가 (멱등)
DROP POLICY IF EXISTS customers_staff_update ON customers;

CREATE POLICY customers_staff_update ON customers
  FOR UPDATE TO authenticated
  USING (is_floor_staff())
  WITH CHECK (is_floor_staff());

COMMENT ON POLICY customers_staff_update ON customers IS
  'T-20260520-foot-STAFF-CUSTOMER-UPDATE: staff/part_lead/tm 역할이 customers 행 UPDATE 가능. 민감 컬럼(rrn) 보호는 SECURITY DEFINER RPC + FE canEditSensitive=false에서 처리.';
`;

async function query(sql) {
  const resp = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    }
  );
  const data = await resp.json();
  if (!resp.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function run() {
  console.log('T-20260520-foot-STAFF-CUSTOMER-UPDATE: 마이그레이션 적용 시작');
  console.log('Project:', PROJECT_ID);

  // 마이그레이션 적용
  try {
    const result = await query(MIGRATION_SQL);
    console.log('✅ 마이그레이션 적용 완료:', JSON.stringify(result));
  } catch (e) {
    console.error('❌ 마이그레이션 실패:', e.message);
    process.exit(1);
  }

  // 검증 1: customers UPDATE 정책 목록
  console.log('\n검증: customers 테이블 UPDATE 정책 확인...');
  try {
    const policies = await query(`
      SELECT policyname, cmd, roles
        FROM pg_policies
       WHERE schemaname='public' AND tablename='customers' AND cmd='UPDATE'
       ORDER BY policyname;
    `);
    console.log('📋 customers UPDATE 정책 목록:');
    if (Array.isArray(policies)) {
      policies.forEach(p => console.log(`  ${p.policyname} | ${p.cmd} | ${p.roles}`));
      const hasStaffUpdate = policies.some(p => p.policyname === 'customers_staff_update');
      console.log(hasStaffUpdate
        ? '✅ customers_staff_update 정책 확인됨'
        : '❌ customers_staff_update 정책 미확인 — 수동 확인 필요'
      );
    } else {
      console.log(JSON.stringify(policies, null, 2));
    }
  } catch (e) {
    console.log('검증 쿼리 실패 (무시):', e.message);
  }

  // 검증 2: is_floor_staff() 함수 확인
  console.log('\n검증: is_floor_staff() 함수 존재 확인...');
  try {
    const funcs = await query(`
      SELECT proname, prosecdef
        FROM pg_proc
       WHERE proname = 'is_floor_staff'
         AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname='public');
    `);
    if (Array.isArray(funcs) && funcs.length > 0) {
      console.log('✅ is_floor_staff() 함수 확인됨. SECURITY DEFINER:', funcs[0].prosecdef);
    } else {
      console.log('❌ is_floor_staff() 함수 미확인:', JSON.stringify(funcs));
    }
  } catch (e) {
    console.log('검증 2 실패 (무시):', e.message);
  }

  console.log('\n완료. AC-1/AC-2: staff/part_lead 고객 전화번호·주소 수정 → DB 허용됨.');
  console.log('AC-3: 기존 customers_consult_update / customers_coord_update 정책 유지.');
  console.log('AC-4: 롤백 → supabase/migrations/20260520000070_customers_staff_update_rls.down.sql');
}

run().catch(e => {
  console.error('❌ 오류:', e);
  process.exit(1);
});
