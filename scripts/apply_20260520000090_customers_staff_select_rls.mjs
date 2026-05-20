/**
 * T-20260520-foot-CUSTOMER-SELECT-RLS
 * customers SELECT RLS — staff/part_lead/tm 명시적 추가
 * P0 hotfix: 초진 차트 안 열림 (staff 계정 전원)
 *
 * 실행: SUPABASE_ACCESS_TOKEN=... node scripts/apply_20260520000090_customers_staff_select_rls.mjs
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROJECT_ID = 'rxlomoozakkjesdqjtvd';
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  console.error('❌ SUPABASE_ACCESS_TOKEN 환경변수 필요');
  process.exit(1);
}

const MIGRATION_SQL = `
-- T-20260520-foot-CUSTOMER-SELECT-RLS: customers SELECT RLS — staff/part_lead/tm 명시적 추가

-- 1. is_floor_staff() 재확인 (idempotent)
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
  'T-20260520-foot-CUSTOMER-SELECT-RLS: 운영 직원 판정 (admin/manager/director/staff/part_lead/tm). idempotent.';

GRANT EXECUTE ON FUNCTION is_floor_staff() TO authenticated;
REVOKE EXECUTE ON FUNCTION is_floor_staff() FROM anon, public;

-- 2. customers SELECT 정책 추가
DROP POLICY IF EXISTS customers_staff_select ON customers;

CREATE POLICY customers_staff_select ON customers
  FOR SELECT TO authenticated
  USING (is_floor_staff());

COMMENT ON POLICY customers_staff_select ON customers IS
  'T-20260520-foot-CUSTOMER-SELECT-RLS: staff/part_lead/tm/admin/manager/director SELECT. belt-and-suspenders.';
`;

async function run() {
  console.log('T-20260520-foot-CUSTOMER-SELECT-RLS: 마이그레이션 적용 시작');
  console.log('Project:', PROJECT_ID);

  const resp = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: MIGRATION_SQL }),
    }
  );

  const result = await resp.json();

  if (!resp.ok) {
    console.error('❌ 마이그레이션 실패:', JSON.stringify(result, null, 2));
    process.exit(1);
  }

  console.log('✅ 마이그레이션 적용 완료:', JSON.stringify(result));

  // 검증: customers 테이블 RLS 정책 확인
  console.log('\n검증: customers 테이블 RLS 정책 목록...');
  const verifyResp = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `
          SELECT policyname, cmd, roles
          FROM pg_policies
          WHERE schemaname='public' AND tablename='customers'
          ORDER BY cmd, policyname;
        `
      }),
    }
  );

  const verifyResult = await verifyResp.json();
  if (verifyResp.ok) {
    console.log('📋 customers 정책 목록:');
    if (Array.isArray(verifyResult)) {
      verifyResult.forEach(p => {
        console.log(`  ${p.policyname} | ${p.cmd} | ${p.roles}`);
      });
      const hasStaffSelect = verifyResult.some(p => p.policyname === 'customers_staff_select');
      console.log(hasStaffSelect
        ? '✅ customers_staff_select 정책 확인됨'
        : '❌ customers_staff_select 정책 미확인 — 수동 확인 필요'
      );
    } else {
      console.log(JSON.stringify(verifyResult, null, 2));
    }
  } else {
    console.log('검증 쿼리 실패 (무시):', JSON.stringify(verifyResult));
  }

  // 검증: is_floor_staff 함수 확인
  console.log('\n검증: is_floor_staff() 함수 존재 확인...');
  const funcResp = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `
          SELECT proname, prosecdef
          FROM pg_proc
          WHERE proname = 'is_floor_staff'
            AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname='public');
        `
      }),
    }
  );

  const funcResult = await funcResp.json();
  if (funcResp.ok && Array.isArray(funcResult) && funcResult.length > 0) {
    console.log('✅ is_floor_staff() 함수 확인됨. SECURITY DEFINER:', funcResult[0].prosecdef);
  } else {
    console.log('❌ is_floor_staff() 함수 미확인:', JSON.stringify(funcResult));
  }
}

run().catch(e => {
  console.error('❌ 오류:', e);
  process.exit(1);
});
