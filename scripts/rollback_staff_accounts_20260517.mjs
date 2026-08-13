/**
 * 롤백: T-20260517-foot-STAFF-BULK 직원 계정 18명 삭제
 *
 * 실행 방법:
 *   DRY_RUN=true  node scripts/rollback_staff_accounts_20260517.mjs   ← 대상 확인만
 *   DRY_RUN=false node scripts/rollback_staff_accounts_20260517.mjs   ← 실제 삭제 (supervisor 승인 후)
 *
 * ⚠️  주의: auth.users + user_profiles 영구 삭제. 복구 불가.
 * ⚠️  admin/manager/director 계정은 삭제 대상에서 제외됨.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const DRY_RUN = process.env.DRY_RUN !== 'false';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

// 생성된 18명 이메일 목록
const STAFF_EMAILS = [
  'm***@naver.com',
  'j***@naver.com',
  'a***@naver.com',
  'k***@naver.com',
  'j***@naver.com',
  'j***@naver.com',
  'a***@naver.com',
  'a***@gmail.com',
  'b***@naver.com',
  'b***@gmail.com',
  'g***@gmail.com',
  's***@naver.com',
  'k***@naver.com',
  'c***@naver.com',
  'm***@naver.com',
  'm***@naver.com',
  '0***@hanmail.net',
  'b***@naver.com',
];

function log(msg)  { console.log(msg); }
function ok(msg)   { console.log(`✅ ${msg}`); }
function fail(msg) { console.error(`❌ ${msg}`); }
function warn(msg) { console.warn(`⚠️  ${msg}`); }

async function main() {
  log('='.repeat(60));
  log('풋센터 직원 계정 18명 롤백 스크립트');
  log(`T-20260517-foot-STAFF-BULK`);
  log(`모드: ${DRY_RUN ? '🔍 DRY-RUN (읽기 전용)' : '🚨 실제 삭제'}`);
  log('='.repeat(60));

  // 1. user_profiles에서 대상 user_id 수집
  const { data: profiles, error: profileErr } = await supabase
    .from('user_profiles')
    .select('id, email, name, role')
    .in('email', STAFF_EMAILS.map(e => e.toLowerCase()));

  if (profileErr) {
    fail(`user_profiles 조회 실패: ${profileErr.message}`);
    process.exit(1);
  }

  log(`\n── 삭제 대상 (user_profiles) ──`);
  for (const p of profiles ?? []) {
    // 안전장치: admin/manager/director는 삭제 금지
    if (['admin', 'manager', 'director'].includes(p.role)) {
      warn(`SKIP (권한 보호): ${p.name} (${p.email}) — role=${p.role}`);
    } else {
      log(`  DELETE: ${p.name} (${p.email}) id=${p.id}`);
    }
  }
  log(`대상 ${profiles?.length ?? 0}건\n`);

  if (DRY_RUN) {
    log('DRY-RUN 완료. 실제 삭제하려면:');
    log('  DRY_RUN=false node scripts/rollback_staff_accounts_20260517.mjs');
    return;
  }

  // 2. auth.users 삭제 (cascade → user_profiles도 삭제됨)
  let deleted = 0;
  for (const p of profiles ?? []) {
    if (['admin', 'manager', 'director'].includes(p.role)) continue;

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

main().catch(err => {
  fail(`치명 오류: ${err.message}`);
  process.exit(1);
});
