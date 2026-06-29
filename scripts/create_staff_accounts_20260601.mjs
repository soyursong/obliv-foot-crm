/**
 * 풋센터 종로 신규 스태프 3명 CRM 계정 생성
 * T-20260601-foot-ACCOUNT-CREATE-NEWSTAFF
 *
 * 코디 2명(coordinator) · 치료사 1명(therapist)
 *
 * 생성 범위(계정 1건당):
 *   1) Supabase Auth user 생성 (email_confirm=true)
 *      → handle_new_user 트리거가 user_profiles 선삽입(name=email, role=coordinator,
 *        approved=false, clinic_id=null)
 *   2) user_profiles UPDATE → name / role / approved=true / active=true / clinic_id 보정
 *   3) staff INSERT → clinic_id / name / role / active=true / user_id=auth uid 연결
 *      (current_staff_id() = staff.user_id = auth.uid() 이력 추적 활성화)
 *
 * idempotent (AC-5):
 *   - auth.users 이메일 이미 존재 → Auth 생성 스킵, 기존 userId 재사용
 *   - staff 동일 user_id row 이미 존재 → staff INSERT 스킵
 *
 * 실행:
 *   DRY_RUN=true  node scripts/create_staff_accounts_20260601.mjs   ← 검증만(읽기 전용)
 *   DRY_RUN=false node scripts/create_staff_accounts_20260601.mjs   ← 실제 생성
 *
 * 롤백: rollback_staff_accounts_20260601.mjs
 */

import { createClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────────
// 설정
// ─────────────────────────────────────────────
const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const CLINIC_SLUG = 'jongno-foot';
const DEFAULT_PASSWORD = (process.env.STAFF_TEMP_PASSWORD || (() => { throw new Error('STAFF_TEMP_PASSWORD env required (no plaintext fallback)'); })()); // 임시 PW — 최초 로그인 후 개인 변경 안내 (기존 풋 신규계정 SOP)
const DRY_RUN = process.env.DRY_RUN !== 'false'; // 기본값: true

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ─────────────────────────────────────────────
// 명단 (3명) — cross_crm_data_contract §2-3 표준 role enum 정합
// ─────────────────────────────────────────────
const STAFF_LIST = [
  { name: '장예지', email: 'jangyeji1242@naver.com', role: 'coordinator', job: '코디' },
  { name: '김지혜', email: 'wlgp3907@naver.com',     role: 'coordinator', job: '코디' },
  { name: '박소예', email: 'yoonha62@gmail.com',     role: 'therapist',   job: '치료사' },
];

// ─────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────
function log(msg)  { console.log(msg); }
function warn(msg) { console.warn(`⚠️  ${msg}`); }
function ok(msg)   { console.log(`✅ ${msg}`); }
function fail(msg) { console.error(`❌ ${msg}`); }

// ─────────────────────────────────────────────
// STEP 1: clinic_id 조회
// ─────────────────────────────────────────────
async function getClinicId() {
  const { data, error } = await supabase
    .from('clinics')
    .select('id, name, slug')
    .eq('slug', CLINIC_SLUG)
    .single();

  if (error || !data) {
    throw new Error(`clinics[slug=${CLINIC_SLUG}] 조회 실패: ${error?.message}`);
  }
  ok(`clinic 확인: ${data.name} (${data.id})`);
  return data.id;
}

// ─────────────────────────────────────────────
// STEP 2: 기존 auth.users 이메일 → userId 맵 (중복 방지/재사용)
// ─────────────────────────────────────────────
async function getExistingUsers() {
  const byEmail = new Map(); // emailLower → userId
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers 실패: ${error.message}`);
    if (!data?.users?.length) break;

    for (const u of data.users) {
      if (u.email) byEmail.set(u.email.toLowerCase(), u.id);
    }
    if (data.users.length < perPage) break;
    page++;
  }

  log(`기존 auth.users: ${byEmail.size}건 로드`);
  return byEmail;
}

// ─────────────────────────────────────────────
// STEP 3: 계정 생성 (Auth + user_profiles + staff)
// ─────────────────────────────────────────────
async function createAccount(staff, clinicId, existingUsers, dryRun) {
  const emailLower = staff.email.toLowerCase();
  let userId = existingUsers.get(emailLower);
  const alreadyAuth = Boolean(userId);

  if (dryRun) {
    log(`  [DRY] ${staff.name} (${emailLower}) [${staff.job}/${staff.role}]`);
    if (alreadyAuth) {
      log(`        → Auth 존재(${userId}) → 생성 스킵, profiles/staff 보정 대상`);
    } else {
      log(`        → auth.admin.createUser(email_confirm) → user_profiles UPDATE → staff INSERT`);
    }
    return { success: true, dry: true };
  }

  // 1) Auth user (없을 때만 생성)
  if (!alreadyAuth) {
    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email: emailLower,
      password: DEFAULT_PASSWORD,
      email_confirm: true,
    });
    if (authErr) {
      return { success: false, error: `Auth 생성 실패: ${authErr.message}` };
    }
    userId = authData.user.id;
  } else {
    warn(`${staff.name}: Auth 이미 존재(${userId}) → 생성 스킵`);
  }

  // 2) user_profiles UPDATE (트리거 선삽입 행 보정)
  const { error: profileErr } = await supabase
    .from('user_profiles')
    .update({
      email: emailLower,
      name: staff.name,
      role: staff.role,
      approved: true,
      active: true,
      clinic_id: clinicId,
    })
    .eq('id', userId);

  if (profileErr) {
    return { success: false, userId, error: `user_profiles UPDATE 실패: ${profileErr.message}` };
  }

  // 3) staff INSERT (idempotent — 동일 user_id row 있으면 스킵)
  const { data: existingStaff, error: staffSelErr } = await supabase
    .from('staff')
    .select('id, name, role')
    .eq('user_id', userId)
    .maybeSingle();

  if (staffSelErr) {
    return { success: false, userId, error: `staff 조회 실패: ${staffSelErr.message}` };
  }

  if (existingStaff) {
    warn(`${staff.name}: staff row 이미 존재(${existingStaff.id}) → INSERT 스킵`);
  } else {
    const { error: staffInsErr } = await supabase
      .from('staff')
      .insert({
        clinic_id: clinicId,
        name: staff.name,
        role: staff.role,
        active: true,
        user_id: userId,
      });
    if (staffInsErr) {
      return { success: false, userId, error: `staff INSERT 실패: ${staffInsErr.message}` };
    }
  }

  return { success: true, userId, alreadyAuth };
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────
async function main() {
  log('='.repeat(60));
  log(`풋센터 종로 신규 스태프 3명 CRM 계정 생성`);
  log(`T-20260601-foot-ACCOUNT-CREATE-NEWSTAFF`);
  log(`모드: ${DRY_RUN ? '🔍 DRY-RUN (읽기 전용)' : '🚀 실제 실행'}`);
  log('='.repeat(60));

  const clinicId = await getClinicId();
  const existingUsers = await getExistingUsers();

  // 중복 현황 (AC-5)
  log(`\n── 이메일 중복 현황 (idempotent 확인) ──`);
  for (const s of STAFF_LIST) {
    if (existingUsers.has(s.email.toLowerCase())) {
      warn(`이미 존재: ${s.name} (${s.email}) → 재사용(생성 스킵)`);
    } else {
      log(`  신규: ${s.name} (${s.email})`);
    }
  }
  log(`────────────────────────────────────\n`);

  log(`── 계정 생성 (${DRY_RUN ? 'DRY-RUN' : '실제'}) ──`);
  const results = [];
  let successCount = 0;
  let failCount = 0;

  for (const staff of STAFF_LIST) {
    const result = await createAccount(staff, clinicId, existingUsers, DRY_RUN);
    if (result.success) {
      ok(`${staff.name} (${staff.email}) [${staff.job}/${staff.role}] ${DRY_RUN ? '→ DRY OK' : `→ ${result.userId}`}`);
      results.push({ ...staff, status: 'ok', userId: result.userId });
      successCount++;
    } else {
      fail(`${staff.name} (${staff.email}): ${result.error}`);
      results.push({ ...staff, status: 'fail', error: result.error });
      failCount++;
    }
  }

  log('\n' + '='.repeat(60));
  log(`결과 요약`);
  log(`  총 대상: ${STAFF_LIST.length}명`);
  log(`  성공:    ${successCount}명`);
  log(`  실패:    ${failCount}명`);
  log(`  모드:    ${DRY_RUN ? 'DRY-RUN (실제 생성 없음)' : '실제 생성 완료'}`);

  if (!DRY_RUN && failCount === 0) {
    log('');
    ok('AC-1: 3 auth.users 생성/확인');
    ok('AC-2: staff 3행 INSERT (user_id 매핑 / role 정합 / clinic 정합)');
    ok('AC-5: 이메일·user_id 중복 0건 (idempotent)');
    log('');
    log('✉️  로그인 정보 (responder 경유 김주연 총괄 전달 — 안전채널):');
    log(`   CRM URL: https://obliv-foot-crm.vercel.app`);
    log(`   임시 PW: ${DEFAULT_PASSWORD} (최초 로그인 후 개인 변경 안내)`);
    for (const r of results) {
      log(`   - ${r.name} | ${r.email} | ${r.role}`);
    }
  }
  if (DRY_RUN) {
    log('');
    log('ℹ️  DRY-RUN 완료. 실제 생성: DRY_RUN=false node scripts/create_staff_accounts_20260601.mjs');
  }
  log('='.repeat(60));

  return failCount === 0;
}

main().catch((err) => {
  fail(`치명 오류: ${err.message}`);
  process.exit(1);
});
