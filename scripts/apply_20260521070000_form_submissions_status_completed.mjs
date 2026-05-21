/**
 * T-20260520-foot-PENCHART-VIEW-SPLIT REOPEN
 * form_submissions.status CHECK constraint에 'completed' 추가
 *
 * 배경: health_questionnaire 저장 시 status='completed' → CHECK 위반 → INSERT 무성 실패
 *       → 상담내역 [내용보기] 버튼 비활성. FE는 'signed'로 수정, DB도 'completed' 허용 안전망.
 *
 * 실행: SUPABASE_ACCESS_TOKEN=... node scripts/apply_20260521070000_form_submissions_status_completed.mjs
 */

const PROJECT_ID = 'rxlomoozakkjesdqjtvd';
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  console.error('❌ SUPABASE_ACCESS_TOKEN 환경변수 필요');
  process.exit(1);
}

const MIGRATION_SQL = `
DO $$
BEGIN
  ALTER TABLE form_submissions
    DROP CONSTRAINT IF EXISTS form_submissions_status_check;
END $$;

ALTER TABLE form_submissions
  ADD CONSTRAINT form_submissions_status_check
  CHECK (status IN ('draft', 'printed', 'signed', 'voided', 'completed'));

COMMENT ON COLUMN form_submissions.status IS
  'draft/printed/signed/voided/completed. completed 추가 — T-20260521 PENCHART-VIEW-SPLIT REOPEN';
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
  console.log('🚀 form_submissions.status CHECK constraint 업데이트 중...');

  await runQuery(MIGRATION_SQL, 'migration');
  console.log('✅ 마이그레이션 실행 완료');

  // 검증: constraint 존재 확인
  const checkResult = await runQuery(
    `SELECT conname, pg_get_constraintdef(oid) AS def
     FROM pg_constraint
     WHERE conrelid = 'form_submissions'::regclass
       AND contype = 'c'
       AND conname = 'form_submissions_status_check';`,
    'verify'
  );

  if (checkResult?.length > 0) {
    console.log('✅ constraint 확인:', JSON.stringify(checkResult));
    if (JSON.stringify(checkResult).includes('completed')) {
      console.log('✅ completed 값 포함 확인');
    } else {
      console.warn('⚠️ completed 미포함 — 확인 필요:', JSON.stringify(checkResult));
    }
  } else {
    console.warn('⚠️ constraint 확인 불명확:', JSON.stringify(checkResult));
  }
}

run().catch(err => {
  console.error('❌ 예외:', err);
  process.exit(1);
});
