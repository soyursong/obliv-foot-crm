/**
 * T-20260721-foot-PAYVIEWER-ACCOUNT-CHOI — 기존 계정 승인/활성화 (approve_existing)
 *
 * 배경: 총괄 김주연(foot 데이터오너)이 pk.choi@medibuilder.com 을 role=관리자(admin)로
 *       CRM에 직접 등록 완료. dev 는 '생성'이 아니라 '승인/활성화'만 수행(생성 절대 금지).
 *       요청자=최필경(오블리브/doAI 결제모듈 담당, U05L6HE7QF6).
 *
 * 스코프(2vef 불변, 신규 아님):
 *   1) auth 존재 확인 — GoTrue admin `?email=` 필터 신뢰 금지(INV-1). listUsers 전량 페이지네이션 +
 *      앱레벨 trim+lowercase 완전일치(===)만 후보(INV-2). 0건→not-found abort(INV-3). ≥2건→hard error.
 *   2) 승인/활성화 — email_confirm(email_confirmed_at) + user_profiles.active/approved pending 시 true.
 *      role 은 손대지 않음(총괄이 직접 결정한 admin 존중, 변경 금지).
 *   3) 초기 비밀번호 설정 — destructive(updateUserById) 직전 getUserById 재조회 id↔email 재검증(INV-4).
 *
 * 실행:
 *   DRY_RUN=true  node scripts/T-20260721-foot-PAYVIEWER-ACCOUNT-CHOI_approve.mjs   (기본: 진단만)
 *   DRY_RUN=false node scripts/T-20260721-foot-PAYVIEWER-ACCOUNT-CHOI_approve.mjs   (적용)
 *   TEMP_PW 미지정 시 crypto 로 임시비번 생성(적용 모드에서만).
 *
 * 회수(rollback, over-privilege 임시부여 성격 — ROLE-MATRIX-3TIER-RBAC 완료 시 read-only 승격 권장):
 *   UPDATE user_profiles SET active=false, approved=false WHERE id='<AUTH_ID>';
 *   (auth ban: supabase.auth.admin.updateUserById(id,{ban_duration:'876000h'}) — 회수 시)
 *
 * DDL/파괴적 변경 없음. state UPDATE + auth email_confirm/password 만. e2e_spec_exempt=db_only.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => {
  // .env.local 폴백 로드(gitignored) — plaintext 커밋 금지
  try {
    const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    const m = env.match(/SUPABASE_SERVICE_ROLE_KEY=(\S+)/);
    if (m) return m[1];
  } catch { /* noop */ }
  throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)');
})());

const TARGET_EMAIL = 'pk.choi@medibuilder.com';
const NORM = (e) => (e || '').trim().toLowerCase();
const DRY_RUN = process.env.DRY_RUN !== 'false';

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ── INV-1/2/3: 전량 페이지네이션 + 앱레벨 exact match ──────────────────────
async function resolveByEmailExact(email) {
  const want = NORM(email);
  const matches = [];
  let page = 1;
  const perPage = 1000;
  for (;;) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers page=${page}: ${error.message}`);
    const users = data?.users || [];
    for (const u of users) if (NORM(u.email) === want) matches.push(u);
    if (users.length < perPage) break;
    page += 1;
    if (page > 50) throw new Error('pagination guard: >50 pages');
  }
  return matches;
}

async function main() {
  console.log(`=== T-20260721 PAYVIEWER CHOI 승인/활성화 (${DRY_RUN ? 'DRY-RUN 진단' : 'APPLY'}) ===`);
  console.log(`대상 이메일: ${TARGET_EMAIL}\n`);

  // [1] auth 존재 확인 (INV-1/2/3)
  const matches = await resolveByEmailExact(TARGET_EMAIL);
  console.log(`[1] auth.users 전량조회 exact-match 결과: ${matches.length}건`);
  if (matches.length === 0) {
    console.error(`❌ NOT-FOUND: ${TARGET_EMAIL} auth 계정 부재.`);
    console.error('   → fresh create 금지(스코프). planner 회신 필요: 총괄 "관리자 등록 완료" 진술과 불일치.');
    process.exit(2);
  }
  if (matches.length >= 2) {
    console.error(`❌ AMBIGUOUS: 동일 이메일 ${matches.length}건 — destructive 거부(INV-3). 수동 확인 필요.`);
    console.error('   ids:', matches.map(u => u.id).join(', '));
    process.exit(3);
  }
  const authUser = matches[0];
  const AUTH_ID = authUser.id;
  console.log(`  ✅ 단일 계정 확정: id=${AUTH_ID}`);
  console.log(`     email_confirmed_at: ${authUser.email_confirmed_at || 'NULL (미인증)'}`);
  console.log(`     banned_until:       ${authUser.banned_until || '없음'}`);
  console.log(`     last_sign_in_at:    ${authUser.last_sign_in_at || '없음(미로그인)'}`);
  console.log(`     created_at:         ${authUser.created_at}`);

  // [2] user_profiles row 확인
  const { data: prof, error: pe } = await sb
    .from('user_profiles').select('*').eq('id', AUTH_ID).maybeSingle();
  if (pe) console.error('  user_profiles 조회 err:', pe.message);
  console.log('\n[2] user_profiles row:');
  console.log('  ', JSON.stringify(prof, null, 2));

  // [3] staff row 확인(참고)
  const { data: staff } = await sb
    .from('staff').select('id,name,role,active,clinic_id,user_id').eq('user_id', AUTH_ID);
  console.log('\n[3] staff row(user_id 링크):');
  console.log('  ', JSON.stringify(staff, null, 2));

  // 승인/활성화 필요 항목 판정
  const needEmailConfirm = !authUser.email_confirmed_at;
  const needBanClear = !!authUser.banned_until;
  const needActive = prof ? prof.active !== true : null;   // null=profile 부재
  const needApproved = prof ? prof.approved !== true : null;
  console.log('\n[판정] 승인/활성화 필요 항목:');
  console.log(`  · email_confirm : ${needEmailConfirm ? 'YES(미인증→인증)' : 'no(이미 인증)'}`);
  console.log(`  · ban clear     : ${needBanClear ? 'YES(밴 해제)' : 'no'}`);
  console.log(`  · profile.active   : ${needActive === null ? '⚠ profile 부재' : (needActive ? 'YES(→true)' : 'no(이미 true)')}`);
  console.log(`  · profile.approved : ${needApproved === null ? '⚠ profile 부재' : (needApproved ? 'YES(→true)' : 'no(이미 true)')}`);
  console.log(`  · role          : ${prof?.role ?? '?'} (변경 안 함 — 총괄 결정 admin 존중)`);
  console.log('  · password      : 초기 비밀번호 설정(요청자 첫 로그인용)');

  if (prof === null) {
    console.error('\n❌ user_profiles row 부재. 총괄이 "관리자로 등록"했다면 profile row가 있어야 함.');
    console.error('   활성화 대상 불명확 → planner 회신 후 결정(자동 생성 금지: 스코프=승인).');
    if (DRY_RUN) { console.log('\n(DRY-RUN 종료)'); process.exit(0); }
    process.exit(4);
  }

  if (DRY_RUN) {
    console.log('\n🔍 DRY-RUN — 변경 없음. 적용: DRY_RUN=false node scripts/T-20260721-foot-PAYVIEWER-ACCOUNT-CHOI_approve.mjs');
    process.exit(0);
  }

  // ── APPLY ────────────────────────────────────────────────────────────────
  // INV-4: destructive(updateUserById) 직전 getUserById 재조회 id↔email 재검증
  const { data: reget, error: rge } = await sb.auth.admin.getUserById(AUTH_ID);
  if (rge) { console.error('❌ getUserById 재검증 실패:', rge.message); process.exit(5); }
  if (NORM(reget?.user?.email) !== NORM(TARGET_EMAIL)) {
    console.error(`❌ TOCTOU 가드: id=${AUTH_ID} 의 email(${reget?.user?.email}) != 기대(${TARGET_EMAIL}) — 중단.`);
    process.exit(6);
  }
  console.log(`\n[INV-4] id↔email 재검증 OK (${AUTH_ID} ↔ ${reget.user.email})`);

  const TEMP_PW = process.env.TEMP_PW || `Choi!${randomBytes(6).toString('base64url')}9`;

  // 3-1. auth: email_confirm + (필요시 ban 해제) + 초기 비밀번호
  const authPatch = { email_confirm: true, password: TEMP_PW };
  if (needBanClear) authPatch.ban_duration = 'none';
  const { data: au, error: ae } = await sb.auth.admin.updateUserById(AUTH_ID, authPatch);
  if (ae) { console.error('❌ auth updateUserById 실패:', ae.message); process.exit(7); }
  console.log(`✅ auth 갱신: email_confirmed_at=${au?.user?.email_confirmed_at || '설정됨'}, password 재설정, ban=${needBanClear ? '해제' : '변경없음'}`);

  // 3-2. user_profiles: active/approved true (role 불변)
  const { data: pu, error: pue } = await sb
    .from('user_profiles').update({ active: true, approved: true }).eq('id', AUTH_ID).select();
  if (pue) { console.error('❌ user_profiles update 실패:', pue.message); process.exit(8); }
  console.log('✅ user_profiles.active=true, approved=true:', JSON.stringify(pu));

  // staff row 존재 시 active 정합
  if (staff && staff.length === 1 && staff[0].active !== true) {
    const { error: se } = await sb.from('staff').update({ active: true }).eq('id', staff[0].id);
    if (se) console.error('⚠ staff.active update 실패(비차단):', se.message);
    else console.log(`✅ staff.active=true (id=${staff[0].id})`);
  }

  console.log('\n=== 완료 ===');
  console.log(`로그인 이메일: ${TARGET_EMAIL}`);
  console.log(`임시 비밀번호: ${TEMP_PW}`);
  console.log(`접속 주소   : https://obliv-foot-crm.pages.dev`);
  console.log('role=admin(임시부여·회수가능). 최필경(U05L6HE7QF6) DM 전달 권장.');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
