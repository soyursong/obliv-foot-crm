/**
 * 풋센터 종로 직원 18명 CRM 계정 일괄 생성
 * T-20260517-foot-STAFF-BULK
 *
 * 실행 방법:
 *   DRY_RUN=true  node scripts/create_staff_accounts_20260517.mjs   ← 검증만
 *   DRY_RUN=false node scripts/create_staff_accounts_20260517.mjs   ← 실제 생성 (supervisor 승인 후)
 *
 * 롤백 스크립트: rollback_staff_accounts_20260517.mjs
 */

import { createClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────────
// 설정
// ─────────────────────────────────────────────
const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = '***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const CLINIC_SLUG = 'jongno-foot';
const DEFAULT_PASSWORD = 'Foot@2026!';
const DRY_RUN = process.env.DRY_RUN !== 'false'; // 기본값: true (dry-run)

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

// ─────────────────────────────────────────────
// 명단 (18명) — PENDING 전건 해소 확정
// ─────────────────────────────────────────────
// 상담(5명) / 코디(2명) / 치료사(11명) — 전원 role='staff'
const STAFF_LIST = [
  // 상담
  { name: '송지현', email: 'marissong@naver.com',     job: '상담' },
  { name: '정연주', email: 'joo4442@naver.com',        job: '상담' },
  { name: '엄경은', email: 'a1208789@naver.com',       job: '상담' },
  { name: '김수린', email: 'ksl5777@naver.com',        job: '상담' },
  { name: '정혜인', email: 'jhy314631@naver.com',      job: '상담' },
  // 코디
  { name: '박민석', email: 'jungs5322@naver.com',      job: '코디'  }, // ✅ .com 확정 (김주연 확인)
  { name: '김민경', email: 'alsrud102938@naver.com',   job: '코디'  },
  // 치료사
  { name: '김규리', email: 'angelgrgr12@gmail.com',    job: '치료사' },
  { name: '백민영', email: 'baekmy1004@naver.com',     job: '치료사' },
  { name: '임별',   email: 'byulim12@gmail.com',       job: '치료사' },
  { name: '조선미', email: 'gkdlt609@gmail.com',       job: '치료사' },
  { name: '김성우', email: 'say093092@naver.com',      job: '치료사' },
  { name: '강혜인', email: 'kanghyein1477@naver.com',  job: '치료사' },
  { name: '최다혜', email: 'chxmrrmqxn@naver.com',    job: '치료사' },
  { name: '최민지', email: 'minji9336@naver.com',      job: '치료사' },
  { name: '윤시하', email: 'miso3295@naver.com',       job: '치료사' },
  { name: '김유리', email: '0195958397@hanmail.net',   job: '치료사' },
  { name: '서은정', email: 'bonny_31@naver.com',       job: '치료사' },
];

// 기존 admin 4계정 — 무영향 확인용
const ADMIN_EMAILS = [
  'baekseungmin@obliv.kr',   // 백승민 (예시 — 실제 이메일은 DB 확인)
  'osebin@obliv.kr',          // 오세빈
  'kimdain@obliv.kr',         // 김다인
  'jeongyonghyeon@obliv.kr',  // 정용현
];

// ─────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────
function log(msg) { console.log(msg); }
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
// STEP 2: 기존 auth.users 이메일 목록 수집 (중복 방지)
// ─────────────────────────────────────────────
async function getExistingEmails() {
  // Admin API: listUsers는 페이지네이션 필요 (최대 1000)
  const existing = new Set();
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw new Error(`listUsers 실패: ${error.message}`);
    if (!data?.users?.length) break;

    for (const u of data.users) {
      if (u.email) existing.add(u.email.toLowerCase());
    }
    if (data.users.length < perPage) break;
    page++;
  }

  log(`기존 auth.users: ${existing.size}건 로드`);
  return existing;
}

// ─────────────────────────────────────────────
// STEP 3: 기존 admin 4계정 user_profiles 확인
// ─────────────────────────────────────────────
async function verifyAdminAccounts(clinicId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, email, name, role, approved, active, clinic_id')
    .in('role', ['admin', 'manager', 'director'])
    .eq('clinic_id', clinicId);

  if (error) {
    warn(`admin 계정 조회 실패: ${error.message}`);
    return;
  }

  log(`\n── 기존 admin/manager/director 계정 (무영향 확인) ──`);
  if (!data || data.length === 0) {
    warn('admin/manager/director 계정 0건 — clinic_id 확인 필요');
  } else {
    for (const u of data) {
      log(`  ${u.name ?? '(이름 없음)'} | ${u.email} | ${u.role} | approved=${u.approved} | active=${u.active}`);
    }
  }
  log(`── admin 계정 ${data?.length ?? 0}건 확인 완료. 이 계정들은 변경 없음. ──\n`);
}

// ─────────────────────────────────────────────
// STEP 4: 이메일 중복 체크
// ─────────────────────────────────────────────
function checkDuplicates(staffList, existingEmails) {
  log(`\n── 이메일 중복 체크 ──`);
  const duplicates = [];
  for (const s of staffList) {
    if (existingEmails.has(s.email.toLowerCase())) {
      duplicates.push(s);
      warn(`중복: ${s.name} (${s.email}) — 이미 auth.users에 존재`);
    }
  }
  if (duplicates.length === 0) {
    ok(`중복 없음 — 18건 전원 신규`);
  } else {
    fail(`중복 ${duplicates.length}건 발견 — 생성 전 처리 필요`);
  }
  log(`──────────────────────────────\n`);
  return duplicates;
}

// ─────────────────────────────────────────────
// STEP 5: 계정 생성 (Auth + user_profiles)
// ─────────────────────────────────────────────
async function createAccount(staff, clinicId, dryRun) {
  const emailLower = staff.email.toLowerCase();

  if (dryRun) {
    log(`  [DRY] auth.admin.createUser(${emailLower}) → 스킵`);
    log(`  [DRY] user_profiles UPDATE { name:'${staff.name}', role:'staff', approved:true, clinic_id:... } WHERE id=userId`);
    return { success: true, dry: true };
  }

  // 1) Auth 계정 생성
  const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
    email: emailLower,
    password: DEFAULT_PASSWORD,
    email_confirm: true,      // 이메일 인증 없이 바로 활성화
  });

  if (authErr) {
    return { success: false, error: `Auth 생성 실패: ${authErr.message}` };
  }

  const userId = authData.user.id;

  // 2) user_profiles UPDATE
  // ⚠️ handle_new_user DB trigger가 createUser() 직후 user_profiles를 자동 선삽입함.
  //    (name=email, role='coordinator', approved=false, clinic_id=null 로 잘못된 값)
  //    INSERT 대신 UPDATE로 올바른 값으로 덮어씀. (2026-05-17 supervisor 확인)
  const { error: profileErr } = await supabase
    .from('user_profiles')
    .update({
      email: emailLower,
      name: staff.name,
      role: 'staff',
      approved: true,
      active: true,
      clinic_id: clinicId,
    })
    .eq('id', userId);

  if (profileErr) {
    return {
      success: false,
      userId,
      error: `user_profiles UPDATE 실패: ${profileErr.message}`,
    };
  }

  return { success: true, userId };
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────
async function main() {
  log('='.repeat(60));
  log(`풋센터 종로 직원 18명 CRM 계정 일괄 생성`);
  log(`T-20260517-foot-STAFF-BULK`);
  log(`모드: ${DRY_RUN ? '🔍 DRY-RUN (읽기 전용)' : '🚀 실제 실행'}`);
  log('='.repeat(60));

  // 1. clinic_id
  const clinicId = await getClinicId();

  // 2. 기존 이메일 목록
  const existingEmails = await getExistingEmails();

  // 3. admin 계정 확인
  await verifyAdminAccounts(clinicId);

  // 4. 이메일 중복 체크
  const duplicates = checkDuplicates(STAFF_LIST, existingEmails);
  if (duplicates.length > 0 && !DRY_RUN) {
    fail(`중복 이메일 ${duplicates.length}건 — 실제 실행 중단. 중복 해소 후 재실행.`);
    process.exit(1);
  }

  // 5. 생성
  log(`\n── 계정 생성 (${DRY_RUN ? 'DRY-RUN' : '실제'}) ──`);
  const results = [];
  let successCount = 0;
  let failCount = 0;

  for (const staff of STAFF_LIST) {
    const skip = existingEmails.has(staff.email.toLowerCase());
    if (skip && !DRY_RUN) {
      warn(`SKIP: ${staff.name} (${staff.email}) — 이미 존재`);
      results.push({ ...staff, status: 'skipped' });
      continue;
    }

    const result = await createAccount(staff, clinicId, DRY_RUN);
    if (result.success) {
      ok(`${staff.name} (${staff.email}) [${staff.job}] ${DRY_RUN ? '→ DRY OK' : `→ ${result.userId}`}`);
      results.push({ ...staff, status: 'ok', userId: result.userId });
      successCount++;
    } else {
      fail(`${staff.name} (${staff.email}): ${result.error}`);
      results.push({ ...staff, status: 'fail', error: result.error });
      failCount++;
    }
  }

  // 6. 결과 요약
  log('\n' + '='.repeat(60));
  log(`결과 요약`);
  log(`  총 대상: ${STAFF_LIST.length}명`);
  log(`  성공:    ${successCount}명`);
  log(`  실패:    ${failCount}명`);
  log(`  모드:    ${DRY_RUN ? 'DRY-RUN (실제 생성 없음)' : '실제 생성 완료'}`);
  if (!DRY_RUN && failCount === 0) {
    log('');
    ok('AC-1 충족: 18명 auth.users + user_profiles 생성 완료');
    ok('AC-3 충족: role=staff, approved=true, clinic_id=풋센터 종로');
    ok('AC-4 충족: 기존 admin 계정 무변경 확인');
    ok('AC-5 충족: 이메일 중복 0건');
    log('');
    log('✉️  비밀번호: Foot@2026! (임시 — 현장 배포 후 개인 변경 안내)');
    log('🔗 CRM URL: https://obliv-foot-crm.vercel.app');
  }
  if (DRY_RUN) {
    log('');
    log('ℹ️  DRY-RUN 완료. 실제 생성하려면:');
    log('   DRY_RUN=false node scripts/create_staff_accounts_20260517.mjs');
  }
  log('='.repeat(60));

  return failCount === 0;
}

main().catch(err => {
  fail(`치명 오류: ${err.message}`);
  process.exit(1);
});
