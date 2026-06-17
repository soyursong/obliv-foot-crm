/**
 * T-20260617-foot-STAFF-ADMIN-LEESY — 이성열 admin 계정 생성/권한부여 (실행용)
 *
 * 선확인 결과(precheck): 이성열 기존 auth/profile/staff 없음 → 신규 생성 경로.
 *
 * /admin 접근 권한의 단일 진실원천 = user_profiles.role (auth.users 링크).
 *  - admin/manager/tm/staff = 비임상직 → staff row 생성 skip (admin_register_user RPC 정책 준수).
 *  - admin role은 user_profiles 한 행으로 충족. staff row는 칸반·시술 동선용이라 admin엔 불필요.
 *
 * 실행: LEESY_EMAIL=<이메일> DRY_RUN=false node scripts/T-20260617-foot-STAFF-ADMIN-LEESY_grant.mjs
 *  - DRY_RUN 기본 true (조회만). DRY_RUN=false 일 때만 실제 생성/grant.
 *  - 가역: 회수 시 user_profiles.active=false 또는 role 강등 / auth 계정 삭제로 롤백.
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const FOOT_ORIGIN_CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // jongno-foot (오블리브의원 서울 오리진점)
const TARGET_NAME = '이성열';
const EMAIL = (process.env.LEESY_EMAIL || '').trim().toLowerCase();
const DRY_RUN = process.env.DRY_RUN !== 'false';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function genTempPassword() {
  // 임시 비밀번호 — 본인 최초 로그인 후 변경 권고. 출력으로 전달.
  return 'Foot!' + crypto.randomBytes(9).toString('base64url');
}

async function main() {
  console.log(`=== 이성열 admin grant (DRY_RUN=${DRY_RUN}) ===`);
  if (!EMAIL) {
    console.error('ABORT: LEESY_EMAIL 미설정. 이메일 회신 후 LEESY_EMAIL=<주소>로 재실행.');
    process.exit(2);
  }
  console.log('email:', EMAIL);

  // 1. 동일 이메일 auth 계정 기존 존재 확인 (재실행 안전성)
  const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  let user = (list?.users || []).find(u => (u.email || '').toLowerCase() === EMAIL);

  if (DRY_RUN) {
    console.log('[DRY_RUN] auth 계정 존재:', !!user, user?.id || '');
    console.log('[DRY_RUN] 실제 생성하려면 DRY_RUN=false 로 재실행.');
    return;
  }

  // 2. auth 계정 생성 (없을 때만)
  let tempPw = null;
  if (!user) {
    tempPw = genTempPassword();
    const { data: created, error: ce } = await supabase.auth.admin.createUser({
      email: EMAIL,
      password: tempPw,
      email_confirm: true,
      user_metadata: { name: TARGET_NAME },
    });
    if (ce) { console.error('createUser error:', ce.message); process.exit(1); }
    user = created.user;
    console.log('auth 계정 생성:', user.id);
  } else {
    console.log('auth 계정 기존 존재 → 재사용:', user.id);
  }

  // 3. user_profiles upsert (admin)
  const { error: ue } = await supabase
    .from('user_profiles')
    .upsert({
      id: user.id,
      email: EMAIL,
      name: TARGET_NAME,
      role: 'admin',
      clinic_id: FOOT_ORIGIN_CLINIC_ID,
      approved: true,
      active: true,
    }, { onConflict: 'id' });
  if (ue) { console.error('user_profiles upsert error:', ue.message); process.exit(1); }
  console.log('user_profiles upsert OK (role=admin, clinic=jongno-foot)');

  // 4. 검증
  const { data: verify } = await supabase
    .from('user_profiles')
    .select('id, email, name, role, clinic_id, active, approved')
    .eq('id', user.id)
    .single();
  console.log('VERIFY:', JSON.stringify(verify, null, 2));

  console.log('\n=== 완료 ===');
  console.log('이성열님 admin 계정 활성. /admin 접근 가능.');
  if (tempPw) {
    console.log('임시 비밀번호(본인 전달, 최초 로그인 후 변경 권고):', tempPw);
  } else {
    console.log('기존 auth 계정 재사용 — 비밀번호 변경 불요(기존 비밀번호 유지).');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
