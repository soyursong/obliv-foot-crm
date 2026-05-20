/**
 * T-20260520-foot-PENCHART-CHECKLIST-REMOVE
 * form_templates soft-delete: personal_checklist_general / personal_checklist_senior
 * active = false 로 비활성화 — 기존 form_submissions 참조 보존 (데이터 삭제 아님)
 *
 * 실행: SUPABASE_ACCESS_TOKEN=... node scripts/apply_20260521000010_remove_personal_checklist_templates.mjs
 */

const PROJECT_ID = 'rxlomoozakkjesdqjtvd';
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  console.error('❌ SUPABASE_ACCESS_TOKEN 환경변수 필요');
  process.exit(1);
}

const MIGRATION_SQL = `
-- T-20260520-foot-PENCHART-CHECKLIST-REMOVE
-- 개인정보+체크리스트 2종 form_templates soft-delete
-- 현장 요청: 불필요 판단 → select 패널에서 제거
-- form_submissions 참조 없음 (dry-run 확인됨) — 기존 저장 데이터 보존 목적 soft-delete
UPDATE form_templates
SET active = false
WHERE form_key IN ('personal_checklist_general', 'personal_checklist_senior');
`;

async function run() {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: MIGRATION_SQL }),
    },
  );

  const text = await res.text();
  if (!res.ok) {
    console.error('❌ Migration failed:', res.status, text);
    process.exit(1);
  }

  let json;
  try { json = JSON.parse(text); } catch { json = text; }

  console.log('✅ Migration applied:', JSON.stringify(json, null, 2));

  // dry-run: 비활성화 결과 확인
  const verifyRes = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `SELECT form_key, active FROM form_templates WHERE form_key IN ('personal_checklist_general', 'personal_checklist_senior');`,
      }),
    },
  );
  const verifyText = await verifyRes.text();
  console.log('🔍 Verify result:', verifyText);
}

run().catch((e) => { console.error(e); process.exit(1); });
