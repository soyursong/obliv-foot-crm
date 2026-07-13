/**
 * T-20260713-foot-ACCOUNT-LOGIN-FAIL-FACEOFANGEL — RC 진단 (READ-ONLY, prod write 0)
 *
 * 증상: faceofangel9999@oblivseoul.kr 로그인이 "갑자기" 안 됨 (단일 계정 신고, 김주연 총괄).
 * 목표: 인증단계 실패 vs 로그인후 무기능 감별 + "갑자기"의 시점 특정 + 다계정/배포회귀 여부.
 *
 * ⚠ Auth Identity Resolution 표준 (GOTRUE-ADMIN-EMAIL-FILTER-BAN):
 *   - ?email= 서버필터/부분매칭 단독 신뢰 금지 → listUsers 전량 페이지네이션 후 클라이언트 exact match.
 *   - 매칭 user 는 getUserById(id) 로 id↔email 재검증.
 *   - 동일/유사 email 중복행 존재 여부 리포트.
 *
 * 실행: SUPABASE_SERVICE_ROLE_KEY=... node scripts/T-20260713-...FACEOFANGEL_diag.mjs
 *   민감정보 평문 적재 금지 — encrypted_password/이메일 원문 외 credential 미출력.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const TARGET = 'faceofangel9999@oblivseoul.kr'.toLowerCase();

const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const pick = (u) => u && ({
  id: u.id,
  email: u.email,
  email_confirmed_at: u.email_confirmed_at ?? null,
  confirmed_at: u.confirmed_at ?? null,
  banned_until: u.banned_until ?? null,
  deleted_at: u.deleted_at ?? null,
  is_sso_user: u.is_sso_user ?? null,
  is_anonymous: u.is_anonymous ?? null,
  created_at: u.created_at ?? null,
  updated_at: u.updated_at ?? null,               // 비번변경/상태변경 등 마지막 mutate 시점
  last_sign_in_at: u.last_sign_in_at ?? null,
  phone: u.phone ?? null,
  identities: (u.identities || []).map(i => ({ provider: i.provider, id: i.id, identity_id: i.identity_id, last_sign_in_at: i.last_sign_in_at, updated_at: i.updated_at })),
  app_metadata: u.app_metadata ?? null,
  user_metadata_keys: Object.keys(u.user_metadata || {}),  // 값 노출 없이 키만
});

async function main() {
  console.log('=== FACEOFANGEL LOGIN-FAIL 진단 (READ-ONLY) ===', new Date().toISOString());
  console.log('target email:', TARGET, '\n');

  // 1) listUsers 전량 페이지네이션 → 클라이언트 exact/유사 매칭 (?email= 단독 신뢰 금지)
  let page = 1, all = [];
  for (;;) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) { console.error('listUsers err:', error.message); break; }
    const users = data?.users || [];
    all.push(...users);
    if (users.length < 1000) break;
    page++;
    if (page > 50) { console.error('!! page cap hit'); break; }
  }
  console.log(`[1] auth.users 전량 스캔: ${all.length}명`);

  const exact = all.filter(u => (u.email || '').toLowerCase() === TARGET);
  const local = TARGET.split('@')[0];
  const similar = all.filter(u => {
    const e = (u.email || '').toLowerCase();
    return e !== TARGET && (e.includes(local) || e.startsWith('faceofangel'));
  });
  console.log(`  exact match: ${exact.length}건`);
  console.log(`  유사(local-part/faceofangel*) 매치: ${similar.length}건`, similar.map(u => ({ id: u.id, email: u.email })));

  if (exact.length === 0) {
    console.log('\n  ❌ exact email 계정 부재. → 이메일 오타/삭제/타 CRM 계정 가능성. 유사매치 확인 요.');
    return;
  }
  if (exact.length > 1) {
    console.log('\n  ⚠ 동일 email 중복행! Auth Identity 오염 가능. 전건 덤프.');
  }

  for (const u of exact) {
    console.log('\n[2] auth.users row (listUsers):');
    console.log(JSON.stringify(pick(u), null, 2));

    // id↔email 재검증
    const { data: byId, error: e2 } = await svc.auth.admin.getUserById(u.id);
    const reok = byId?.user && (byId.user.email || '').toLowerCase() === TARGET;
    console.log(`\n[3] getUserById(${u.id}) id↔email 재검증: ${reok ? '✅ 일치' : '❌ 불일치'}`);
    if (e2) console.log('   getUserById err:', e2.message);
    if (byId?.user && !reok) console.log('   재검증 email:', byId.user.email);

    // 상태 판정
    const st = pick(u);
    const flags = [];
    if (!st.email_confirmed_at) flags.push('EMAIL_UNCONFIRMED(로그인 차단 가능)');
    if (st.banned_until) flags.push(`BANNED_UNTIL=${st.banned_until}`);
    if (st.deleted_at) flags.push(`SOFT_DELETED=${st.deleted_at}`);
    if (st.is_sso_user) flags.push('IS_SSO_USER(비번로그인 불가)');
    if (st.is_anonymous) flags.push('IS_ANONYMOUS');
    if (!(u.identities || []).some(i => i.provider === 'email')) flags.push('NO_EMAIL_IDENTITY(비번로그인 불가)');
    console.log('\n[4] 인증차단 플래그:', flags.length ? flags.join(', ') : '(없음 — 인증단계 정상 추정)');
    console.log('    updated_at(마지막 mutate):', st.updated_at, '/ last_sign_in_at:', st.last_sign_in_at);

    // user_profiles 정합 (service role = RLS 우회)
    const { data: prof, error: pe } = await svc.from('user_profiles').select('*').eq('id', u.id).maybeSingle();
    console.log('\n[5] user_profiles(by id, service role):', pe ? `ERR ${pe.message}` : (prof ? JSON.stringify(prof, null, 2) : 'NULL (프로필 없음 → 로그인 후 메뉴 전무)'));

    // staff 링크 정합
    const { data: staff, error: se } = await svc.from('staff').select('*').eq('user_id', u.id);
    console.log('\n[6] staff(by user_id):', se ? `ERR ${se.message}` : JSON.stringify(staff, null, 2));
  }

  console.log('\n[7] 감별 결론 가이드:');
  console.log('  - [4] 플래그 있음 → 인증단계 실패 (GoTrue 레벨). "갑자기"는 updated_at 시점.');
  console.log('  - [4] 플래그 없음 + [5] profile NULL/active=false → 로그인후 무기능 (derm COORD-ACCT-NOFUNC 유형).');
  console.log('  - exact>1 또는 [3] 불일치 → Auth Identity 오염.');
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
