/**
 * T-20260526-foot-PMW-SIDEMENU-FEAT — RLS hardening
 * service_menu_order 정책 교체: USING(true) → clinic_id 격리
 * Supabase Management API 경유 실행
 *
 * FIX-REQUEST: MSG-20260527-161701-3s3j (supervisor)
 */

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY  = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const PROJ_REF     = 'rxlomoozakkjesdqjtvd';

const SQL = `
-- Step 1: 기존 개방 정책 제거
DROP POLICY IF EXISTS "clinic members can manage service_menu_order"
  ON service_menu_order;

-- Step 2: clinic_id 격리 정책 생성
CREATE POLICY "smo_clinic_isolated"
  ON service_menu_order
  FOR ALL
  TO authenticated
  USING  (clinic_id = current_user_clinic_id()::text)
  WITH CHECK (clinic_id = current_user_clinic_id()::text);

COMMENT ON POLICY "smo_clinic_isolated" ON service_menu_order IS
  'T-20260526-foot-PMW-SIDEMENU-FEAT RLS hardening: '
  'authenticated 전용 + clinic_id = current_user_clinic_id()::text 격리. '
  'FIX: 기존 USING(true)/WITH CHECK(true) 대체 (MSG-20260527-161701-3s3j).';

-- Step 3: 검증
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'service_menu_order'
       AND policyname = 'clinic members can manage service_menu_order'
  ) THEN
    RAISE EXCEPTION 'OLD 정책 제거 실패';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'service_menu_order'
       AND policyname = 'smo_clinic_isolated'
  ) THEN
    RAISE EXCEPTION '신규 정책 smo_clinic_isolated 생성 실패';
  END IF;
END $$;
`;

console.log('🔒 T-20260526-foot-PMW-SIDEMENU-FEAT RLS hardening 시작...');
console.log('   service_menu_order: USING(true) → clinic_id 격리');

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
  },
  body: JSON.stringify({ query: SQL }),
});

const json = await res.json().catch(() => ({}));

if (!res.ok) {
  console.error('❌ RLS 정책 업데이트 실패:', JSON.stringify(json, null, 2));
  process.exit(1);
}

// 검증: pg_policies 조회
const verifyRes = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
  },
  body: JSON.stringify({
    query: `
      SELECT policyname, cmd, roles, qual
        FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = 'service_menu_order'
       ORDER BY policyname;
    `,
  }),
});

const verifyJson = await verifyRes.json().catch(() => ({}));

if (!verifyRes.ok) {
  console.error('⚠️  검증 조회 실패 (정책은 적용됐을 수 있음):', verifyJson);
} else {
  const rows = verifyJson.result ?? verifyJson ?? [];
  console.log('\n✅ service_menu_order 현재 RLS 정책:');
  console.table(rows);

  const hasOld = rows.some(r => r.policyname === 'clinic members can manage service_menu_order');
  const hasNew = rows.some(r => r.policyname === 'smo_clinic_isolated');

  if (hasOld) {
    console.error('❌ OLD 정책이 아직 존재합니다. 수동 확인 필요.');
    process.exit(1);
  }
  if (!hasNew) {
    console.error('❌ 신규 정책 smo_clinic_isolated가 없습니다. 수동 확인 필요.');
    process.exit(1);
  }

  console.log('✅ RLS hardening 완료: smo_clinic_isolated 적용됨');
}
