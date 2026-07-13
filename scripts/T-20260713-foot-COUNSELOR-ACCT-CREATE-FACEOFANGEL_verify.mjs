/**
 * T-20260713-foot-COUNSELOR-ACCT-CREATE-FACEOFANGEL — 계정 실재 재검증 (READ-ONLY)
 *
 * 목적: 상담실장(김지윤, faceofangel9999@oblivseoul.kr) 신규 생성 요청.
 *   단, 동일 이메일 LOGIN-FAIL 진단 티켓과 오버랩 → 생성 전 auth.users 실재부터 확인.
 *   미존재 → 생성 경로 / 존재 → 신규생성 금지(duplicate), LOGIN-FAIL 복구로 처리.
 *
 * 준수: Cross-CRM Auth Identity Resolution 표준
 *   - `?email=` 서버필터 단독 신뢰 금지 → 전량 페이지네이션 후 exact match
 *   - destructive/판정 직전 getUserById 로 id↔email 재검증
 * role 매핑: cross_crm_data_contract §2-3 → 상담실장 = `consultant`
 * READ-ONLY. prod write 0.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const TARGET_EMAIL = 'faceofangel9999@oblivseoul.kr';
const TARGET_NAME = '김지윤';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const norm = (e) => (e || '').trim().toLowerCase();

async function main() {
  console.log('=== T-20260713-foot-COUNSELOR-ACCT-CREATE-FACEOFANGEL 실재 재검증 (READ-ONLY) ===');
  console.log('target email:', TARGET_EMAIL, '/ name:', TARGET_NAME, '\n');

  // [1] auth.users 전량 페이지네이션 스캔 → exact email match (?email= 서버필터 미신뢰)
  console.log('[1] auth.users 전량 스캔 (exact email match, 서버필터 미신뢰)');
  let exactMatches = [];
  let nameHits = [];
  let page = 1;
  let scanned = 0;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) { console.error('  listUsers error:', error.message); break; }
    const users = data?.users || [];
    scanned += users.length;
    for (const u of users) {
      if (norm(u.email) === norm(TARGET_EMAIL)) exactMatches.push(u);
      const meta = JSON.stringify(u.user_metadata || {});
      if (meta.includes(TARGET_NAME)) nameHits.push({ id: u.id, email: u.email });
    }
    if (users.length < 1000) break;
    page++;
  }
  console.log(`  스캔 계정 수: ${scanned}`);
  console.log(`  exact email match: ${exactMatches.length}`);
  console.log(`  이름("${TARGET_NAME}") 메타 hit: ${nameHits.length}`, JSON.stringify(nameHits));

  if (exactMatches.length === 0) {
    console.log('\n=== 판정: 미존재 → 신규 생성 경로 (GoTrue create + profile/staff 연결) ===');
    console.log('VERDICT: NOT_FOUND');
    return;
  }
  if (exactMatches.length > 1) {
    console.log('\n⚠ 동일 이메일 다중 매치 → 수동 검토 필요');
  }

  // [2] id↔email 재검증 (getUserById) — listUsers identities quirk 회피
  console.log('\n[2] id↔email 재검증 (getUserById)');
  for (const m of exactMatches) {
    const { data: byId, error } = await supabase.auth.admin.getUserById(m.id);
    if (error) { console.error('  getUserById error:', error.message); continue; }
    const u = byId.user;
    const idents = (u.identities || []).map(i => ({ provider: i.provider, id_email: i.identity_data?.email, sub: i.identity_data?.sub }));
    console.log('  ', JSON.stringify({
      id: u.id,
      email: u.email,
      email_matches: norm(u.email) === norm(TARGET_EMAIL),
      email_confirmed_at: u.email_confirmed_at,
      banned_until: u.banned_until ?? null,
      deleted_at: u.deleted_at ?? null,
      is_sso_user: u.is_sso_user,
      last_sign_in_at: u.last_sign_in_at,
      created_at: u.created_at,
      updated_at: u.updated_at,
      role_meta: u.user_metadata?.role,
      identities: idents,
    }, null, 2));
  }

  const uid = exactMatches[0].id;

  // [3] user_profiles (SSOT) 조회
  console.log('\n[3] user_profiles WHERE id = uid');
  const { data: profById } = await supabase
    .from('user_profiles')
    .select('id, email, name, role, clinic_id, active, approved, created_at')
    .eq('id', uid);
  console.log('  by uid:', JSON.stringify(profById, null, 2));
  const { data: profByEmail } = await supabase
    .from('user_profiles')
    .select('id, email, name, role, clinic_id, active, approved')
    .ilike('email', TARGET_EMAIL);
  console.log('  by email:', JSON.stringify(profByEmail, null, 2));

  // [4] staff 조회 (user_id 링크)
  console.log('\n[4] staff WHERE user_id = uid OR name LIKE');
  const { data: staffByUid } = await supabase
    .from('staff')
    .select('id, clinic_id, name, role, active, user_id, created_at')
    .eq('user_id', uid);
  console.log('  by user_id:', JSON.stringify(staffByUid, null, 2));
  const { data: staffByName } = await supabase
    .from('staff')
    .select('id, clinic_id, name, role, active, user_id')
    .ilike('name', `%${TARGET_NAME}%`);
  console.log('  by name:', JSON.stringify(staffByName, null, 2));

  // [5] 판정 + role 정합 (상담실장=consultant)
  console.log('\n=== 판정 ===');
  const prof = (profById || [])[0];
  const staff = (staffByUid || [])[0];
  console.log('VERDICT: EXISTS → 신규생성 금지(duplicate). LOGIN-FAIL 복구 경로로 이미 처리됨.');
  console.log('상담실장 표준 role = consultant (contract §2-3)');
  console.log(`  user_profiles.role = ${prof?.role} ${prof?.role === 'consultant' ? '(=상담실장 ✓)' : '(≠상담실장 — 요청 role 불일치)'}`);
  console.log(`  staff.role         = ${staff?.role} ${staff?.role === 'consultant' ? '(=상담실장 ✓)' : '(≠상담실장)'}`);
  console.log(`  active/approved    = profile(active=${prof?.active},approved=${prof?.approved}) staff(active=${staff?.active})`);
}

main().catch(e => { console.error(e); process.exit(1); });
