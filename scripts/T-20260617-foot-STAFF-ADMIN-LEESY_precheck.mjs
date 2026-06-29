/**
 * T-20260617-foot-STAFF-ADMIN-LEESY — 선확인(precheck)
 * 이성열님 기존 Supabase auth 계정 + user_profiles + staff row 존재 여부 조회.
 *  - 있으면 → user_profiles.role='admin' grant만(이메일 불요)
 *  - 없으면 → 신규 auth 계정 생성 필요 → 이메일 필수(input_pending)
 * READ-ONLY. 변경 없음.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const TARGET_NAME = '이성열';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function main() {
  console.log('=== T-20260617-foot-STAFF-ADMIN-LEESY 선확인 (이성열) ===\n');

  // 1. auth.users 전체 스캔 — 이메일/메타데이터에 이름 단서 (admin API)
  console.log('[1] auth.users 스캔 (이름/이메일 단서)');
  let authMatches = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) { console.error('  auth.admin.listUsers error:', error.message); break; }
    const users = data?.users || [];
    for (const u of users) {
      const meta = JSON.stringify(u.user_metadata || {});
      const hay = `${u.email || ''} ${meta}`;
      if (hay.includes(TARGET_NAME) || /(?:sy[._]?lee|lee[._]?sy|8512)/i.test(hay)) {
        authMatches.push({ id: u.id, email: u.email, meta: u.user_metadata });
      }
    }
    if (users.length < 1000) break;
    page++;
  }
  console.log('  auth.users 후보:', authMatches.length, JSON.stringify(authMatches, null, 2));

  // 2. user_profiles 이름 매칭
  console.log('\n[2] user_profiles WHERE name LIKE 이성열');
  const { data: profs, error: pe } = await supabase
    .from('user_profiles')
    .select('id, email, name, role, clinic_id, active, approved, created_at')
    .ilike('name', `%${TARGET_NAME}%`);
  if (pe) console.error('  err:', pe.message);
  console.log('  matches:', JSON.stringify(profs, null, 2));

  // 3. staff 이름 매칭
  console.log('\n[3] staff WHERE name LIKE 이성열');
  const { data: staff, error: se } = await supabase
    .from('staff')
    .select('id, clinic_id, name, role, active, user_id, created_at')
    .ilike('name', `%${TARGET_NAME}%`);
  if (se) console.error('  err:', se.message);
  console.log('  matches:', JSON.stringify(staff, null, 2));

  // 4. 판정
  console.log('\n=== 판정 ===');
  const hasAuth = authMatches.length > 0;
  const hasProfile = (profs || []).length > 0;
  const hasStaff = (staff || []).length > 0;
  if (hasProfile || hasAuth) {
    console.log('VERDICT: 기존 계정 후보 발견 → grant 경로 (이메일 불요 가능). 위 후보 본인 확인 필요.');
  } else {
    console.log('VERDICT: 이성열 기존 계정 없음 → 신규 auth 계정 생성 필요 → 이메일 필수(input_pending).');
  }
  console.log(`(auth=${hasAuth} / profile=${hasProfile} / staff=${hasStaff})`);
}

main().catch(e => { console.error(e); process.exit(1); });
