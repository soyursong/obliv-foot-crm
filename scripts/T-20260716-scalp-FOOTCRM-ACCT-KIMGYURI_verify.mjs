/**
 * T-20260716-scalp-FOOTCRM-ACCT-KIMGYURI — 계정 실재 재검증 (READ-ONLY)
 *
 * 목적: 김규리 총괄(rwdqda@naver.com) 풋 CRM 계정 신규 생성 요청.
 *   WARN-1 폴백 확정(두피 CRM 공통 평문 비번 부재 → 임시비번 발급 경로).
 *   생성 전 auth.users 실재부터 확인:
 *     미존재 → 신규 생성 경로 (apply 스크립트)
 *     존재   → 신규생성 금지(duplicate), role/활성 점검 후 FOLLOWUP
 *
 * 준수: Cross-CRM Auth Identity Resolution 표준
 *   - `?email=` 서버필터 단독 신뢰 금지 → 전량 페이지네이션 후 exact match
 *   - 판정 직전 getUserById 로 id↔email 재검증
 * role 매핑: 최소권한 고정 → `staff` (원장/실장 권한 금지). user_profiles.role CHECK enum 정합
 *   ('admin','manager','consultant','coordinator','therapist','technician','tm','staff').
 * READ-ONLY. prod write 0.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const TARGET_EMAIL = 'rwdqda@naver.com';
const TARGET_NAME = '김규리';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const norm = (e) => (e || '').trim().toLowerCase();

async function main() {
  console.log('=== T-20260716-scalp-FOOTCRM-ACCT-KIMGYURI 실재 재검증 (READ-ONLY) ===');
  console.log('target email:', TARGET_EMAIL, '/ name:', TARGET_NAME, '/ 요청 role: staff(최소권한)\n');

  // [1] auth.users 전량 페이지네이션 스캔 → exact email match (?email= 서버필터 미신뢰)
  console.log('[1] auth.users 전량 스캔 (exact email match, 서버필터 미신뢰)');
  const exactMatches = [];
  const nameHits = [];
  let page = 1;
  let scanned = 0;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) { console.error('  listUsers error:', error.message); process.exit(1); }
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
    console.log('\n=== 판정: NOT_FOUND → 신규 생성 경로 (apply 스크립트로 GoTrue create + profile role=staff) ===');
    console.log('VERDICT: NOT_FOUND');
    return;
  }
  if (exactMatches.length > 1) {
    console.log('\n⚠ 동일 이메일 다중 매치 → 수동 검토 필요, 생성 금지');
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

  console.log('\n=== 판정 ===');
  console.log('VERDICT: EXISTS → 신규생성 금지(duplicate). role/활성만 점검 후 planner FOLLOWUP.');
}

main().catch(e => { console.error(e); process.exit(1); });
