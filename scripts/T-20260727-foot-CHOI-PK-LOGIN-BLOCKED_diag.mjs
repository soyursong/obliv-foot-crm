/**
 * T-20260727-foot-CHOI-PK-LOGIN-BLOCKED — 진단 (READ-ONLY)
 * 최필경(pk.choi@medibuilder.com, U05L6HE7QF6, role=manager) 로그인 불가 진단.
 * 7/21 활성화(manager/approved=true/active=true) 후 정상 → 오늘 갑자기 차단.
 *
 * 표준 준수:
 *  - Cross-CRM Auth Identity Resolution: GoTrue admin `?email=` 서버필터 단독 신뢰 금지.
 *    → listUsers 페이지네이션 전수 스캔 + 클라이언트-레벨 이메일 매칭 + id↔email 재검증.
 *  - GoTrue admin email filter ban 표준 준수.
 * 변경 없음(READ-ONLY). auth 스냅샷 + user_profiles(role/approved/active) 진단.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const TARGET_EMAIL = 'pk.choi@medibuilder.com';
const TARGET_EMAIL_LC = TARGET_EMAIL.toLowerCase();

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function snap(u) {
  return {
    id: u.id,
    email: u.email,
    banned_until: u.banned_until ?? null,
    // supabase-js maps some fields; also surface raw where present
    email_confirmed_at: u.email_confirmed_at ?? u.confirmed_at ?? null,
    confirmed_at: u.confirmed_at ?? null,
    last_sign_in_at: u.last_sign_in_at ?? null,
    created_at: u.created_at ?? null,
    updated_at: u.updated_at ?? null,
    deleted_at: u.deleted_at ?? null,
    phone: u.phone ?? null,
    role: u.role ?? null,
    aud: u.aud ?? null,
    has_encrypted_password: (u.encrypted_password != null) || undefined,
    app_metadata: u.app_metadata ?? null,
    user_metadata: u.user_metadata ?? null,
  };
}

async function main() {
  console.log('=== T-20260727-foot-CHOI-PK-LOGIN-BLOCKED 진단 (READ-ONLY) ===');
  console.log('target email:', TARGET_EMAIL, '\n');

  // [1] auth.users 전수 스캔 (서버 email 필터 미신뢰 → 페이지네이션 + 클라 매칭)
  console.log('[1] auth.users 전수 스캔 (listUsers 페이지네이션, 클라이언트 email 매칭)');
  const matches = [];
  let page = 1;
  let scanned = 0;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) { console.error('  listUsers error:', error.message); break; }
    const users = data?.users || [];
    scanned += users.length;
    for (const u of users) {
      if ((u.email || '').toLowerCase() === TARGET_EMAIL_LC) matches.push(u);
    }
    if (users.length < 1000) break;
    page++;
  }
  console.log('  scanned users:', scanned, '| email matches:', matches.length);

  if (matches.length === 0) {
    console.log('\n  ⚠ 해당 이메일의 auth 계정 없음. (id↔email 재검증 불가) → planner 재확인.');
    return;
  }
  if (matches.length > 1) {
    console.log('  ⚠ 동일 이메일 다중 계정 발견:', matches.length, '→ 파괴적 조치 전 planner 재확인 필요.');
  }

  const u = matches[0];

  // [1b] id↔email 재검증 (변경 직전 재검증 의무 — 진단 단계 선행 검증)
  console.log('\n[1b] id↔email 재검증 (getUserById로 재조회, 서버필터 결과와 교차)');
  const { data: byId, error: byIdErr } = await supabase.auth.admin.getUserById(u.id);
  if (byIdErr) { console.error('  getUserById error:', byIdErr.message); }
  const idEmail = byId?.user?.email || null;
  const idMatch = idEmail && idEmail.toLowerCase() === TARGET_EMAIL_LC;
  console.log('  listUsers.id:', u.id);
  console.log('  getUserById.email:', idEmail, '| id↔email 일치:', idMatch);
  if (!idMatch) {
    console.log('  ⚠ id↔email 재검증 실패 → 대상 특정 불가 → 조치 중단, planner 재확인.');
    return;
  }

  console.log('\n[1c] auth.users 스냅샷 (BEFORE):');
  console.log(JSON.stringify(snap(byId?.user || u), null, 2));

  // 진단 플래그
  const su = byId?.user || u;
  const banned = su.banned_until && new Date(su.banned_until).getTime() > Date.now();
  const emailConfirmed = !!(su.email_confirmed_at || su.confirmed_at);
  const deleted = !!su.deleted_at;
  console.log('\n  [auth 진단 플래그]');
  console.log('   - banned_until 활성 차단?:', banned, '(', su.banned_until ?? 'null', ')');
  console.log('   - email_confirmed?:', emailConfirmed);
  console.log('   - deleted_at?:', deleted, '(', su.deleted_at ?? 'null', ')');
  console.log('   - last_sign_in_at:', su.last_sign_in_at ?? 'null');

  // [2] user_profiles (해당 uid) role/approved/active
  console.log('\n[2] user_profiles WHERE id =', u.id);
  const { data: profById, error: pe1 } = await supabase
    .from('user_profiles')
    .select('id, email, name, role, clinic_id, active, approved, created_at, updated_at')
    .eq('id', u.id);
  if (pe1) console.error('  err:', pe1.message);
  console.log('  by id:', JSON.stringify(profById, null, 2));

  // 이메일로도 교차 (uid 미연결 프로필 존재 가능성 점검)
  const { data: profByEmail, error: pe2 } = await supabase
    .from('user_profiles')
    .select('id, email, name, role, clinic_id, active, approved, created_at, updated_at')
    .ilike('email', TARGET_EMAIL);
  if (pe2) console.error('  err(email):', pe2.message);
  console.log('  by email:', JSON.stringify(profByEmail, null, 2));

  // [3] 판정
  console.log('\n=== 판정 ===');
  const prof = (profById || [])[0];
  const profOk = prof && prof.role === 'manager' && prof.approved === true && prof.active === true;
  console.log('  auth 이상(차단/삭제/미확인):', banned || deleted || !emailConfirmed);
  console.log('  user_profiles(manager/approved/active) 정상:', !!profOk,
    prof ? `(role=${prof.role}, approved=${prof.approved}, active=${prof.active})` : '(profile 없음)');

  if (banned || deleted || !emailConfirmed || !profOk) {
    console.log('\n  VERDICT (a): 이상 발견 → 단일-row 비파괴 복구 대상. 복구 스크립트 별도 실행(원상 manager/approved/active).');
    console.log('   복구대상 요약:',
      JSON.stringify({
        auth_banned: banned, auth_deleted: deleted, email_confirmed: emailConfirmed,
        prof_role: prof?.role ?? null, prof_approved: prof?.approved ?? null, prof_active: prof?.active ?? null,
      }));
  } else {
    console.log('\n  VERDICT (b): auth/profile 모두 정상 → 상태변화 이상 없음 → 비밀번호 재설정 링크 발급/안내 경로.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
