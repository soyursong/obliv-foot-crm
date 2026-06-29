/**
 * T-20260520-foot-SLOT-MOVE-REVERT
 * reservations_staff_update RLS 정책 추가
 * - therapist/technician/staff/tm 역할이 reservations UPDATE 가능하도록
 * - 멱등: DROP IF EXISTS 후 CREATE
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY  = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
  console.log('T-20260520-foot-SLOT-MOVE-REVERT: RLS 정책 적용 시작');

  // 기존 정책 조회
  const { data: existing, error: chkErr } = await supabase
    .from('pg_policies')
    .select('policyname')
    .eq('tablename', 'reservations')
    .eq('policyname', 'reservations_staff_update')
    .maybeSingle();

  if (chkErr && !chkErr.message.includes('does not exist')) {
    // pg_policies는 REST 접근 불가 — RPC 방식 사용
  }

  // RPC를 통해 SQL 직접 실행 (service_role은 RLS 우회)
  const { error } = await supabase.rpc('exec_ddl', {
    sql_text: `
      DROP POLICY IF EXISTS reservations_staff_update ON reservations;
      CREATE POLICY reservations_staff_update ON reservations
        FOR UPDATE TO authenticated
        USING (is_approved_user())
        WITH CHECK (is_approved_user());
    `
  });

  if (error) {
    // exec_ddl RPC 없으면 다른 방법 시도
    console.log('exec_ddl not available, trying direct approach...');

    // Supabase Management API (v1) 사용
    const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
    if (!accessToken) {
      console.error('SUPABASE_ACCESS_TOKEN 환경변수 필요');
      process.exit(1);
    }

    const mgmtResp = await fetch('https://api.supabase.com/v1/projects/rxlomoozakkjesdqjtvd/database/query', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `
          DROP POLICY IF EXISTS reservations_staff_update ON reservations;
          CREATE POLICY reservations_staff_update ON reservations
            FOR UPDATE TO authenticated
            USING (is_approved_user())
            WITH CHECK (is_approved_user());
        `
      })
    });

    const result = await mgmtResp.json();
    if (!mgmtResp.ok) {
      console.error('Management API 실패:', JSON.stringify(result));
      process.exit(1);
    }
    console.log('✅ 관리 API 성공:', JSON.stringify(result));
  } else {
    console.log('✅ RPC 성공');
  }

  // 검증: pg_policies 조회
  const verifyResp = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/check_reservations_policy`,
    {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({})
    }
  );

  console.log('완료. 정책 적용 확인을 위해 Supabase 대시보드에서 reservations 테이블 RLS를 확인하세요.');
}

run().catch(console.error);
