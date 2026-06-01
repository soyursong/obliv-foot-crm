/**
 * 롤백: T-20260601-foot-ACCOUNT-CREATE-NEWSTAFF 신규 스태프 3명 삭제
 *
 * 실행:
 *   DRY_RUN=true  node scripts/rollback_staff_accounts_20260601.mjs   ← 대상 확인만
 *   DRY_RUN=false node scripts/rollback_staff_accounts_20260601.mjs   ← 실제 삭제
 *
 * 삭제 순서:
 *   1) staff row 삭제 (user_id 매핑 기준)
 *   2) auth.users 삭제 (cascade → user_profiles 동반 삭제)
 *
 * ⚠️  auth.users + user_profiles + staff 영구 삭제. 복구 불가.
 * ⚠️  admin/manager/director 계정은 안전장치로 삭제 제외.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = '***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const DRY_RUN = process.env.DRY_RUN !== 'false';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const STAFF_EMAILS = [
  'jangyeji1242@naver.com',
  'wlgp3907@naver.com',
  'yoonha62@gmail.com',
];

function log(msg)  { console.log(msg); }
function ok(msg)   { console.log(`✅ ${msg}`); }
function fail(msg) { console.error(`❌ ${msg}`); }
function warn(msg) { console.warn(`⚠️  ${msg}`); }

async function main() {
  log('='.repeat(60));
  log('풋센터 신규 스태프 3명 롤백 스크립트');
  log('T-20260601-foot-ACCOUNT-CREATE-NEWSTAFF');
  log(`모드: ${DRY_RUN ? '🔍 DRY-RUN (읽기 전용)' : '🚨 실제 삭제'}`);
  log('='.repeat(60));

  const { data: profiles, error: profileErr } = await supabase
    .from('user_profiles')
    .select('id, email, name, role')
    .in('email', STAFF_EMAILS.map((e) => e.toLowerCase()));

  if (profileErr) {
    fail(`user_profiles 조회 실패: ${profileErr.message}`);
    process.exit(1);
  }

  log(`\n── 삭제 대상 ──`);
  for (const p of profiles ?? []) {
    if (['admin', 'manager', 'director'].includes(p.role)) {
      warn(`SKIP (권한 보호): ${p.name} (${p.email}) — role=${p.role}`);
    } else {
      log(`  DELETE: ${p.name} (${p.email}) id=${p.id}`);
    }
  }
  log(`대상 ${profiles?.length ?? 0}건\n`);

  if (DRY_RUN) {
    log('DRY-RUN 완료. 실제 삭제: DRY_RUN=false node scripts/rollback_staff_accounts_20260601.mjs');
    return;
  }

  let deleted = 0;
  for (const p of profiles ?? []) {
    if (['admin', 'manager', 'director'].includes(p.role)) continue;

    // 1) staff row 삭제
    const { error: staffErr } = await supabase.from('staff').delete().eq('user_id', p.id);
    if (staffErr) warn(`${p.name} staff 삭제 경고: ${staffErr.message}`);

    // 2) auth.users 삭제 (cascade user_profiles)
    const { error } = await supabase.auth.admin.deleteUser(p.id);
    if (error) {
      fail(`${p.name} (${p.email}) 삭제 실패: ${error.message}`);
    } else {
      ok(`${p.name} (${p.email}) 삭제 완료`);
      deleted++;
    }
  }

  log('\n' + '='.repeat(60));
  log(`롤백 결과: ${deleted}건 삭제`);
  log('='.repeat(60));
}

main().catch((err) => {
  fail(`치명 오류: ${err.message}`);
  process.exit(1);
});
