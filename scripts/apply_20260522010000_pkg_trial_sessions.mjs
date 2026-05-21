/**
 * T-20260522-foot-TRIAL-PKG-ADD
 * packages + package_templates에 trial_sessions/trial_unit_price 컬럼 추가
 * get_package_remaining RPC에 trial 차감 추적 추가
 *
 * 배경: 구입 티켓 추가 화면에 [체험권] 5번째 항목 신설.
 *       session_type 'trial' 허용은 20260521080000_pkg_sessions_trial.sql에서 기완료.
 *
 * 실행: node scripts/apply_20260522010000_pkg_trial_sessions.mjs
 */

const PROJECT_ID = 'rxlomoozakkjesdqjtvd';
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  console.error('❌ SUPABASE_ACCESS_TOKEN 환경변수 필요');
  process.exit(1);
}

const MIGRATION_SQL = `
-- [1] packages 테이블: trial_sessions, trial_unit_price 컬럼 추가
ALTER TABLE packages
  ADD COLUMN IF NOT EXISTS trial_sessions   INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trial_unit_price INT DEFAULT 0;

-- [2] package_templates 테이블: trial_sessions, trial_unit_price 컬럼 추가
ALTER TABLE package_templates
  ADD COLUMN IF NOT EXISTS trial_sessions   INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trial_unit_price INT DEFAULT 0;

-- [3] get_package_remaining RPC 갱신: trial 차감 추적 추가
CREATE OR REPLACE FUNCTION get_package_remaining(p_package_id UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT jsonb_build_object(
    'heated',          p.heated_sessions          - COALESCE(SUM(CASE WHEN ps.session_type = 'heated_laser'    AND ps.status = 'used' THEN 1 ELSE 0 END), 0),
    'unheated',        p.unheated_sessions        - COALESCE(SUM(CASE WHEN ps.session_type = 'unheated_laser'  AND ps.status = 'used' THEN 1 ELSE 0 END), 0),
    'iv',              p.iv_sessions              - COALESCE(SUM(CASE WHEN ps.session_type = 'iv'              AND ps.status = 'used' THEN 1 ELSE 0 END), 0),
    'preconditioning', p.preconditioning_sessions - COALESCE(SUM(CASE WHEN ps.session_type = 'preconditioning' AND ps.status = 'used' THEN 1 ELSE 0 END), 0),
    'podologe',        p.podologe_sessions        - COALESCE(SUM(CASE WHEN ps.session_type = 'podologue'       AND ps.status = 'used' THEN 1 ELSE 0 END), 0),
    'trial',           p.trial_sessions           - COALESCE(SUM(CASE WHEN ps.session_type = 'trial'          AND ps.status = 'used' THEN 1 ELSE 0 END), 0),
    'total_used',      COALESCE(COUNT(ps.id) FILTER (WHERE ps.status = 'used'), 0),
    'total_remaining', p.total_sessions           - COALESCE(COUNT(ps.id) FILTER (WHERE ps.status = 'used'), 0)
  )
  FROM packages p
  LEFT JOIN package_sessions ps ON ps.package_id = p.id
  WHERE p.id = p_package_id
  GROUP BY p.id, p.heated_sessions, p.unheated_sessions, p.iv_sessions,
           p.preconditioning_sessions, p.podologe_sessions, p.trial_sessions, p.total_sessions;
$$;
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
  console.log('🚀 T-20260522-foot-TRIAL-PKG-ADD: packages/package_templates trial 컬럼 + RPC 추가 중...');

  await runQuery(MIGRATION_SQL, 'migration');
  console.log('✅ 마이그레이션 실행 완료');

  // 검증 [1]: packages 컬럼 확인
  const colCheck = await runQuery(
    `SELECT column_name, data_type, column_default
     FROM information_schema.columns
     WHERE table_name IN ('packages', 'package_templates')
       AND column_name IN ('trial_sessions', 'trial_unit_price')
     ORDER BY table_name, column_name;`,
    'verify-columns'
  );
  console.log('✅ 컬럼 확인:', JSON.stringify(colCheck));

  // 검증 [2]: get_package_remaining RPC trial 포함 확인
  const rpcCheck = await runQuery(
    `SELECT proname, prosrc
     FROM pg_proc
     WHERE proname = 'get_package_remaining'
     LIMIT 1;`,
    'verify-rpc'
  );
  if (rpcCheck?.length > 0 && JSON.stringify(rpcCheck).includes('trial')) {
    console.log('✅ get_package_remaining RPC trial 포함 확인');
  } else {
    console.warn('⚠️ RPC trial 확인 불명확:', JSON.stringify(rpcCheck));
  }

  console.log('🎉 전체 완료 — packages/package_templates trial 컬럼 추가 + RPC 갱신 완료');
}

run().catch(err => {
  console.error('❌ 예외:', err);
  process.exit(1);
});
