/**
 * T-20260620-foot-JUYEON-ACCOUNT-FULL-PERM — 선확인(precheck)
 * juyeon@medibuilder.com (김주연 총괄, CRM 구축 담당) 계정 현재 상태 조회.
 *   목적: user_profiles.role 상향(admin) 으로 전체 메뉴 접근권한 부여 위한 현재 role/롤백값 캡처.
 * READ-ONLY. 변경 없음.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const EMAIL = 'juyeon@medibuilder.com';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function main() {
  console.log('=== T-20260620-foot-JUYEON-ACCOUNT-FULL-PERM 선확인 ===\n');
  console.log('target email:', EMAIL, '\n');

  // 1. auth.users 매칭
  console.log('[1] auth.users (email 매칭)');
  let authUser = null;
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) { console.error('  listUsers error:', error.message); break; }
    const users = data?.users || [];
    const m = users.find(u => (u.email || '').toLowerCase() === EMAIL);
    if (m) { authUser = m; break; }
    if (users.length < 1000) break;
    page++;
  }
  console.log('  auth user:', authUser ? JSON.stringify({ id: authUser.id, email: authUser.email, meta: authUser.user_metadata }, null, 2) : 'NONE');

  // 2. user_profiles 매칭 (email + id)
  console.log('\n[2] user_profiles');
  let prof = null;
  if (authUser) {
    const { data } = await supabase
      .from('user_profiles')
      .select('id, email, name, role, clinic_id, active, approved, has_ops_authority, created_at')
      .eq('id', authUser.id)
      .maybeSingle();
    prof = data;
  }
  if (!prof) {
    const { data } = await supabase
      .from('user_profiles')
      .select('id, email, name, role, clinic_id, active, approved, has_ops_authority, created_at')
      .ilike('email', EMAIL);
    console.log('  by-email matches:', JSON.stringify(data, null, 2));
    if (data && data.length) prof = data[0];
  } else {
    console.log('  by-id match:', JSON.stringify(prof, null, 2));
  }

  // 3. 판정 + 롤백값
  console.log('\n=== 판정 ===');
  if (!authUser && !prof) {
    console.log('VERDICT: juyeon 기존 계정 없음 → 신규 admin 계정 생성 경로 (grant 스크립트가 createUser).');
  } else if (authUser && !prof) {
    console.log('VERDICT: auth 계정 존재, user_profiles 없음 → profiles upsert(role=admin) 경로.');
    console.log('ROLLBACK: user_profiles row 삭제 또는 active=false.');
  } else {
    console.log(`VERDICT: 기존 user_profiles 존재 → role 상향 경로. 현재 role='${prof.role}', has_ops_authority=${prof.has_ops_authority}`);
    console.log(`ROLLBACK SQL: UPDATE user_profiles SET role='${prof.role}' WHERE id='${prof.id}';`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
