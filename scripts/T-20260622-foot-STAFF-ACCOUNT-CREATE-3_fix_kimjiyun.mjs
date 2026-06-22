/**
 * T-20260622-foot-STAFF-ACCOUNT-CREATE-3 — 김지윤 로그인 실패 수정
 *
 * 진단(diag.mjs + 스크린샷): 김지윤(faceofangel9999@gmail.com) auth row 존재하나
 *   email_confirmed_at = NULL → 로그인 화면 "Email not confirmed" 에러.
 *   계정은 2026-06-09 회원가입(self-signup) 경로로 생성됐고 이메일 미확인 + 한 번도 로그인 안 됨.
 *   user_profiles / staff 행은 정상(role=consultant, approved/active=true, clinic 정합).
 *   → 이가연·김지현은 이미 정상 로그인(last_sign_in 존재) → 무처리.
 *
 * 수정(김지윤만):
 *   1) auth.admin.updateUserById → email_confirm: true (이메일 확인 처리)
 *   2) password 를 알려진 임시 비번으로 재설정(가입 당시 비번 미상 → 안전채널 전달 위해 재설정)
 *
 * idempotent: 이미 confirmed면 email_confirm 재적용 무해, 비번은 항상 임시값으로 세팅.
 *
 * 롤백: 비번/email_confirm은 본인이 로그인 후 변경. 데이터 파괴 없음(ADDITIVE 상태 변경).
 *
 * 실행:
 *   DRY_RUN=true  node scripts/..._fix_kimjiyun.mjs   ← 검증만
 *   DRY_RUN=false node scripts/..._fix_kimjiyun.mjs   ← 실제 적용
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const TARGET_EMAIL = 'faceofangel9999@gmail.com';
const TEMP_PASSWORD = 'Foot@2026!'; // foot 신규계정 SOP 임시 비번 — 최초 로그인 후 변경 안내
const DRY_RUN = process.env.DRY_RUN !== 'false';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// locate user
let userId = null, before = null;
let page = 1;
outer: while (true) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) { console.error('listUsers fail', error.message); process.exit(1); }
  if (!data?.users?.length) break;
  for (const u of data.users) {
    if (u.email?.toLowerCase() === TARGET_EMAIL.toLowerCase()) { userId = u.id; before = u; break outer; }
  }
  if (data.users.length < 1000) break;
  page++;
}
if (!userId) { console.error(`❌ ${TARGET_EMAIL} auth user not found`); process.exit(1); }

console.log(`대상: ${TARGET_EMAIL} (${userId})`);
console.log(`  현재 email_confirmed_at = ${before.email_confirmed_at || 'NULL (미확인)'}`);
console.log(`  현재 last_sign_in_at    = ${before.last_sign_in_at || 'NEVER'}`);

if (DRY_RUN) {
  console.log('\n🔍 DRY-RUN — 실제 변경 없음. 적용 예정:');
  console.log('  · email_confirm: true');
  console.log(`  · password: (임시 ${TEMP_PASSWORD.replace(/./g, '*')})`);
  console.log('\n실제 적용: DRY_RUN=false node scripts/T-20260622-foot-STAFF-ACCOUNT-CREATE-3_fix_kimjiyun.mjs');
  process.exit(0);
}

const { data: upd, error: updErr } = await supabase.auth.admin.updateUserById(userId, {
  email_confirm: true,
  password: TEMP_PASSWORD,
});
if (updErr) { console.error(`❌ updateUserById 실패: ${updErr.message}`); process.exit(1); }

console.log('\n✅ 적용 완료');
console.log(`  email_confirmed_at = ${upd.user.email_confirmed_at}`);
console.log(`  임시 비번 재설정 완료`);
console.log('\nℹ️  로그인 검증: scripts/T-20260611-...login_verify.mjs --email=... --password=...');
