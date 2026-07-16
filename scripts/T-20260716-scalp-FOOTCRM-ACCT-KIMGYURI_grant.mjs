/**
 * T-20260716-scalp-FOOTCRM-ACCT-KIMGYURI — 김규리 총괄 풋센터 CRM 계정 생성 (실행용)
 *
 * 요청: 김규리 총괄(현장) — obliv-foot-crm 접근용 본인 계정.
 * 확정 경로(planner MSG-20260716-202818-mtcu): 두피 CRM 스태프 공통 평문 비번 미존재 →
 *   WARN-1 폴백 = 임시비번(crypto 랜덤) 발급 + 본인 최초 로그인 후 재설정.
 *
 * 스코프 (ADDITIVE, db_change=false):
 *   1) auth.users 에 rwdqda@naver.com 신규 유저 (email_confirm=true)
 *   2) user_profiles row role='staff' 최소권한 (approved/active=true, clinic=jongno-foot)
 *   3) role=staff 고정 — 원장/실장 등 상위권한 금지 (PHI 최소권한)
 *
 * role=staff = 비임상직 → staff row 생성 skip (admin_register_user RPC 정책 준수, LEESY 선례).
 *   staff row 는 칸반·시술 동선용이라 staff role엔 불필요. user_profiles 한 행으로 충족.
 *
 * ⚠ Cross-CRM Auth Identity Resolution 표준:
 *   GoTrue admin `?email=` 서버필터 단독신뢰 금지. listUsers 페이지네이션 + 로컬필터로 조회하고,
 *   생성 직전/직후 getUserById 로 id↔email 재검증. 이미 존재 시 중복생성 금지 → 종료(FOLLOWUP).
 *
 * ⚠ 임시비번 평문은 signals/board/MQ 본문 기록 금지 — 콘솔 출력으로만(dev→responder 안전채널).
 *
 * 실행:
 *   DRY_RUN=true  node scripts/T-20260716-scalp-FOOTCRM-ACCT-KIMGYURI_grant.mjs  ← 조회/중복확인만
 *   DRY_RUN=false node scripts/T-20260716-scalp-FOOTCRM-ACCT-KIMGYURI_grant.mjs  ← 실제 생성
 *
 * 가역(롤백): 회수 시 user_profiles.active=false / role 강등 / auth 계정 삭제.
 *   rollback SQL: UPDATE user_profiles SET active=false WHERE email='rwdqda@naver.com';
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());

const FOOT_ORIGIN_CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // jongno-foot (오블리브의원 서울 오리진점)
const TARGET_NAME = '김규리';
const EMAIL = 'rwdqda@naver.com';
const ROLE = 'staff'; // 최소권한 고정 — 상위권한 부여 금지
const DRY_RUN = process.env.DRY_RUN !== 'false';

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function genTempPassword() {
  // 임시 비밀번호 — 본인 최초 로그인 후 변경 권고. 콘솔 출력으로만 전달.
  return 'Foot!' + crypto.randomBytes(9).toString('base64url');
}

// listUsers 페이지네이션 + 로컬 소문자 필터 (?email= 서버필터 단독신뢰 금지)
async function findByEmail(email) {
  const target = email.toLowerCase();
  let page = 1;
  while (true) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) { console.error('listUsers fail', error.message); process.exit(1); }
    if (!data?.users?.length) break;
    const hit = data.users.find(u => (u.email || '').toLowerCase() === target);
    if (hit) return hit;
    if (data.users.length < 1000) break;
    page++;
  }
  return null;
}

async function main() {
  console.log(`=== 김규리 총괄 풋 CRM 계정 생성 (DRY_RUN=${DRY_RUN}) ===`);
  console.log('email:', EMAIL, '| role:', ROLE);

  // 1. 중복 확인 (auth-identity 표준: 로컬필터 조회)
  const existing = await findByEmail(EMAIL);
  if (existing) {
    // id↔email 재검증
    const { data: reVerify } = await sb.auth.admin.getUserById(existing.id);
    const reEmail = (reVerify?.user?.email || '').toLowerCase();
    console.log(`\n⚠ 기존 auth 계정 존재: id=${existing.id} email(getUserById)=${reEmail}`);
    if (reEmail !== EMAIL.toLowerCase()) {
      console.error(`❌ id↔email 불일치 — listUsers email=${existing.email} vs getUserById=${reEmail}. 중단(수동확인).`);
      process.exit(3);
    }
    const { data: prof } = await sb.from('user_profiles').select('id,email,name,role,active,approved,clinic_id').eq('id', existing.id).maybeSingle();
    console.log('  user_profiles:', prof ? JSON.stringify(prof) : '없음');
    console.log('\n⛔ 중복생성 금지 (auth-identity 표준). 기존 role/활성 점검 결과 위와 같음 → planner FOLLOWUP 반환 필요.');
    process.exit(10); // exit 10 = 기존 존재, 생성 skip
  }
  console.log('중복 없음 — 신규 생성 경로.');

  if (DRY_RUN) {
    console.log('\n🔍 DRY-RUN — 실제 생성 없음. 적용 예정:');
    console.log(`  · auth.users createUser: ${EMAIL} (email_confirm=true) + 임시비번`);
    console.log(`  · user_profiles: role=${ROLE}, clinic=jongno-foot, approved/active=true`);
    console.log('\n실제 적용: DRY_RUN=false node scripts/T-20260716-scalp-FOOTCRM-ACCT-KIMGYURI_grant.mjs');
    return;
  }

  // 2. auth 계정 생성
  const tempPw = genTempPassword();
  const { data: created, error: ce } = await sb.auth.admin.createUser({
    email: EMAIL,
    password: tempPw,
    email_confirm: true,
    user_metadata: { name: TARGET_NAME },
  });
  if (ce) { console.error('createUser error:', ce.message); process.exit(1); }
  const user = created.user;
  console.log('auth 계정 생성:', user.id);

  // 2b. 생성 직후 id↔email 재검증 (auth-identity 표준)
  const { data: postVerify } = await sb.auth.admin.getUserById(user.id);
  if ((postVerify?.user?.email || '').toLowerCase() !== EMAIL.toLowerCase()) {
    console.error(`❌ 생성 직후 id↔email 재검증 실패: ${postVerify?.user?.email}`); process.exit(1);
  }
  console.log('id↔email 재검증 OK');

  // 3. user_profiles upsert (role=staff 최소권한)
  const { error: ue } = await sb.from('user_profiles').upsert({
    id: user.id,
    email: EMAIL,
    name: TARGET_NAME,
    role: ROLE,
    clinic_id: FOOT_ORIGIN_CLINIC_ID,
    approved: true,
    active: true,
  }, { onConflict: 'id' });
  if (ue) { console.error('user_profiles upsert error:', ue.message); process.exit(1); }
  console.log(`user_profiles upsert OK (role=${ROLE}, clinic=jongno-foot)`);

  // 4. 검증
  const { data: verify } = await sb.from('user_profiles')
    .select('id, email, name, role, clinic_id, active, approved')
    .eq('id', user.id).single();
  console.log('VERIFY:', JSON.stringify(verify, null, 2));

  console.log('\n=== 완료 ===');
  console.log('김규리 총괄 계정 활성 (role=staff 최소권한). 풋 CRM 로그인 가능.');
  console.log('임시 비밀번호(본인 전달, 최초 로그인 후 변경 권고):', tempPw);
}

main().catch(e => { console.error(e); process.exit(1); });
