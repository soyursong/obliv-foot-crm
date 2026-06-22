/**
 * T-20260622-foot-STAFF-ACCOUNT-CREATE-3 — AC-0 접지 + 진단
 * 3 신규 직원(이가연/김지윤=상담실장, 김지현=치료사) 계정 상태 확인.
 * - auth.users 이메일 존재 여부
 * - user_profiles / staff 행 존재 + role/active/approved/clinic_id
 * - 기존 상담실장(consultant) role 값 레퍼런스 (foot 로컬 실제 사용값)
 * - role CHECK 허용값 inventory (기존 staff.role distinct)
 * 읽기 전용.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const TARGETS = [
  { name: '이가연', email: 'dlrkdus10108@naver.com', want: '상담실장' },
  { name: '김지윤', email: 'faceofangel9999@gmail.com', want: '상담실장' },
  { name: '김지현', email: 'oing_woo@naver.com', want: '치료사' },
];

const emailMap = new Map();
let page = 1;
while (true) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) { console.error('listUsers fail', error.message); process.exit(1); }
  if (!data?.users?.length) break;
  for (const u of data.users) if (u.email) emailMap.set(u.email.toLowerCase(), u);
  if (data.users.length < 1000) break;
  page++;
}
console.log(`auth.users total loaded: ${emailMap.size}`);

// role distinct on staff + user_profiles
const { data: staffRows } = await supabase.from('staff').select('role, active, clinic_id').limit(2000);
const staffRoleCount = {};
for (const r of staffRows || []) staffRoleCount[r.role] = (staffRoleCount[r.role] || 0) + 1;
console.log('\n-- staff.role distinct --');
console.log(JSON.stringify(staffRoleCount, null, 2));

const { data: profRows } = await supabase.from('user_profiles').select('role').limit(2000);
const profRoleCount = {};
for (const r of profRows || []) profRoleCount[r.role] = (profRoleCount[r.role] || 0) + 1;
console.log('\n-- user_profiles.role distinct --');
console.log(JSON.stringify(profRoleCount, null, 2));

console.log('\n=== TARGET STATUS ===');
for (const t of TARGETS) {
  const u = emailMap.get(t.email.toLowerCase());
  console.log(`\n[${t.name}] ${t.email} (희망: ${t.want})`);
  if (!u) { console.log('  auth: ❌ NOT FOUND (계정 미생성)'); continue; }
  console.log(`  auth: ✅ ${u.id}  email_confirmed=${!!u.email_confirmed_at}  created=${u.created_at}  last_sign_in=${u.last_sign_in_at || 'NEVER'}`);
  const { data: prof } = await supabase.from('user_profiles').select('*').eq('id', u.id).maybeSingle();
  if (prof) console.log(`  user_profiles: name=${prof.name} role=${prof.role} approved=${prof.approved} active=${prof.active} clinic_id=${prof.clinic_id}`);
  else console.log('  user_profiles: ❌ none');
  const { data: st } = await supabase.from('staff').select('*').eq('user_id', u.id).maybeSingle();
  if (st) console.log(`  staff: id=${st.id} name=${st.name} role=${st.role} active=${st.active} clinic_id=${st.clinic_id}`);
  else console.log('  staff: ❌ none');
}

// reference: 기존 상담실장 명칭 staff (이름에 실장 포함 or role consultant)
const { data: consultRefs } = await supabase.from('staff').select('name, role, active, clinic_id').or('role.eq.consultant,role.eq.counselor').limit(20);
console.log('\n-- consultant/counselor 레퍼런스 staff --');
console.log(JSON.stringify(consultRefs, null, 2));
