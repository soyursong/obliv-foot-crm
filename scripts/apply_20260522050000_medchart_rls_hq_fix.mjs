/**
 * T-20260522-foot-MEDCHART-SAVE-ERR: medical_charts RLS hotfix
 * 
 * 루트 코즈: clinic_id=NULL인 admin 계정이 mc_clinic_isolated WITH CHECK에서 차단.
 * 수정: mc_clinic_isolated_v2 (NULL clinic_id admin/director 허용) + 사용자 보정.
 *
 * 실행: SUPABASE_ACCESS_TOKEN=... node scripts/apply_20260522050000_medchart_rls_hq_fix.mjs
 */

const PROJECT_ID = 'rxlomoozakkjesdqjtvd';
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  console.error('❌ SUPABASE_ACCESS_TOKEN 환경변수 필요');
  process.exit(1);
}

const SQL_STEP1 = `
DROP POLICY IF EXISTS "mc_clinic_isolated"     ON medical_charts;
DROP POLICY IF EXISTS "mc_clinic_isolated_v2"  ON medical_charts;

CREATE POLICY "mc_clinic_isolated_v2" ON medical_charts
  FOR ALL TO authenticated
  USING (
    clinic_id = current_user_clinic_id()::text
    OR (
      current_user_clinic_id() IS NULL
      AND current_user_role() IN ('admin', 'director', 'manager')
    )
  )
  WITH CHECK (
    clinic_id = current_user_clinic_id()::text
    OR (
      current_user_clinic_id() IS NULL
      AND current_user_role() IN ('admin', 'director', 'manager')
    )
  );
`;

const SQL_STEP2 = `
DROP POLICY IF EXISTS "cdm_director_clinic"    ON chart_doctor_memos;
DROP POLICY IF EXISTS "cdm_director_clinic_v2" ON chart_doctor_memos;

CREATE POLICY "cdm_director_clinic_v2" ON chart_doctor_memos
  FOR ALL TO authenticated
  USING (
    (
      clinic_id = current_user_clinic_id()::text
      AND EXISTS (
        SELECT 1 FROM user_profiles
         WHERE id = auth.uid()
           AND role IN ('director', 'admin')
      )
    )
    OR (
      current_user_clinic_id() IS NULL
      AND current_user_role() IN ('admin', 'director')
    )
  )
  WITH CHECK (
    (
      clinic_id = current_user_clinic_id()::text
      AND EXISTS (
        SELECT 1 FROM user_profiles
         WHERE id = auth.uid()
           AND role IN ('director', 'admin')
      )
    )
    OR (
      current_user_clinic_id() IS NULL
      AND current_user_role() IN ('admin', 'director')
    )
  );
`;

const SQL_STEP3 = `
UPDATE user_profiles
  SET clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
  WHERE id = '5c031ae1-739d-4a62-a8e9-5ad81635466b'
    AND clinic_id IS NULL;
`;

const SQL_VERIFY = `
SELECT policyname, cmd
FROM pg_policies
WHERE tablename IN ('medical_charts', 'chart_doctor_memos')
ORDER BY tablename, policyname;
`;

const SQL_VERIFY_USER = `
SELECT id, role, clinic_id, active, approved
FROM user_profiles
WHERE id = '5c031ae1-739d-4a62-a8e9-5ad81635466b';
`;

async function runQuery(sql, label) {
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
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status} [${label}]: ${text}`);
  }
  return resp.json();
}

async function run() {
  console.log('🚀 T-20260522-foot-MEDCHART-SAVE-ERR: RLS hotfix 시작...');

  console.log('\n[1/3] medical_charts RLS 업데이트...');
  await runQuery(SQL_STEP1, 'mc_rls');
  console.log('✅ mc_clinic_isolated_v2 정책 생성');

  console.log('\n[2/3] chart_doctor_memos RLS 업데이트...');
  await runQuery(SQL_STEP2, 'cdm_rls');
  console.log('✅ cdm_director_clinic_v2 정책 생성');

  console.log('\n[3/3] gh.lee@medibuilder.com clinic_id 보정...');
  await runQuery(SQL_STEP3, 'user_fix');
  console.log('✅ clinic_id 보정 완료');

  console.log('\n[검증] RLS 정책 확인...');
  const policies = await runQuery(SQL_VERIFY, 'verify-policies');
  console.log('현재 정책:', JSON.stringify(policies, null, 2));

  // mc_clinic_isolated_v2 존재 확인
  const hasV2 = policies.some(p => p.policyname === 'mc_clinic_isolated_v2');
  const hasOld = policies.some(p => p.policyname === 'mc_clinic_isolated');
  if (!hasV2) throw new Error('mc_clinic_isolated_v2 정책 없음!');
  if (hasOld) throw new Error('구 mc_clinic_isolated 정책이 남아있음!');

  console.log('\n[검증] 사용자 clinic_id 확인...');
  const userResult = await runQuery(SQL_VERIFY_USER, 'verify-user');
  console.log('사용자 상태:', JSON.stringify(userResult));
  if (!userResult[0]?.clinic_id) throw new Error('gh.lee clinic_id 보정 실패!');

  console.log('\n🎉 T-20260522-foot-MEDCHART-SAVE-ERR: RLS hotfix 완료');
  console.log('   - medical_charts: mc_clinic_isolated_v2 (NULL clinic_id admin 허용)');
  console.log('   - chart_doctor_memos: cdm_director_clinic_v2 (동일)');
  console.log('   - gh.lee@medibuilder.com: clinic_id 풋센터로 설정');
}

run().catch(err => {
  console.error('❌ 예외:', err.message);
  process.exit(1);
});
