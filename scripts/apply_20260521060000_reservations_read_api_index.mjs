/**
 * T-20260520-foot-RESERVATIONS-READ-API-EF (TD2) — AC-5
 * reservations 조회 효율화 인덱스
 *
 * 실행: SUPABASE_ACCESS_TOKEN=... node scripts/apply_20260521060000_reservations_read_api_index.mjs
 */

const PROJECT_ID = 'rxlomoozakkjesdqjtvd';
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  console.error('❌ SUPABASE_ACCESS_TOKEN 환경변수 필요');
  process.exit(1);
}

const MIGRATION_SQL = `
-- T-20260520-foot-RESERVATIONS-READ-API-EF (TD2) — AC-5
-- reservations-read-api EF 조회 최적화 인덱스

BEGIN;

CREATE INDEX IF NOT EXISTS idx_reservations_clinic_date_desc
  ON public.reservations(clinic_id, reservation_date DESC, reservation_time DESC)
  WHERE clinic_id IS NOT NULL;

COMMENT ON INDEX idx_reservations_clinic_date_desc IS
  'reservations-read-api EF 조회 최적화 — clinic_id + 날짜 내림차순. T-20260520-foot-RESERVATIONS-READ-API-EF AC-5';

COMMIT;
`;

async function run() {
  console.log('🚀 AC-5 인덱스 마이그레이션 적용 중...');

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

  if (!resp.ok) {
    const text = await resp.text();
    console.error(`❌ HTTP ${resp.status}: ${text}`);
    process.exit(1);
  }

  const result = await resp.json();
  console.log('✅ 마이그레이션 성공:', JSON.stringify(result));

  // 인덱스 존재 확인
  const checkResp = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `SELECT indexname, tablename FROM pg_indexes WHERE indexname = 'idx_reservations_clinic_date_desc';`
      }),
    }
  );

  const checkResult = await checkResp.json();
  if (checkResult?.length > 0 || checkResult?.[0]?.indexname) {
    console.log('✅ 인덱스 확인 완료:', JSON.stringify(checkResult));
  } else {
    console.warn('⚠️ 인덱스 확인 불명확:', JSON.stringify(checkResult));
  }
}

run().catch(err => {
  console.error('❌ 예외:', err);
  process.exit(1);
});
