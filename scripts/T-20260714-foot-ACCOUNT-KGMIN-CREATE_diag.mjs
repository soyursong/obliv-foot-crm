/**
 * T-20260714-foot-ACCOUNT-KGMIN-CREATE — STEP 1 진단 (SELECT-only, 중복 확인)
 *
 * 상담실장 강경민 계정 신규 생성 건.
 * 티켓 대상 이메일: kgm8337@gmail.com  role=consultant
 *
 * 목적 (GOTRUE-EMAIL-FILTER-BAN 준수):
 *   - `?email=` 서버필터 단독 신뢰 금지 → 전체 auth.users 로드 후 needle 매치 전수 수집
 *   - 후보 발견 시 getUserById(id).email == kgm8337@gmail.com 정확 재검증
 *   - 이미 존재 시: 신규 생성 금지(duplicate) → reconcile + planner FOLLOWUP
 *   - 부재 시: 신규 생성 진행 가능
 * 읽기 전용. UPDATE/INSERT/DELETE 없음.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })());
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const NEEDLE = 'kgm8337';
const TARGET_EMAIL = 'kgm8337@gmail.com';
const CLINIC_SLUG = 'jongno-foot';

// clinic_id 확정 (종로 풋)
const { data: clinic, error: ce } = await supabase
  .from('clinics').select('id, name, slug').eq('slug', CLINIC_SLUG).single();
if (ce || !clinic) { console.error('clinics 조회 실패', ce?.message); process.exit(1); }
console.log(`clinic 확인: ${clinic.name} (${clinic.id}) slug=${clinic.slug}\n`);

// 전체 auth.users 로드 → needle 매치 전수 수집
const matches = [];
let page = 1, total = 0;
while (true) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) { console.error('listUsers fail', error.message); process.exit(1); }
  if (!data?.users?.length) break;
  total += data.users.length;
  for (const u of data.users) {
    if (u.email && u.email.toLowerCase().includes(NEEDLE)) matches.push(u);
  }
  if (data.users.length < 1000) break;
  page++;
}
console.log(`auth.users total loaded: ${total}`);
console.log(`"${NEEDLE}" 매치: ${matches.length}건\n`);

for (const u of matches) {
  const exact = u.email.toLowerCase() === TARGET_EMAIL.toLowerCase();
  console.log(`── auth user ${u.id}`);
  console.log(`   email             = ${u.email}  ${exact ? '★티켓대상 정확일치' : '(상이)'}`);
  console.log(`   email_confirmed_at= ${u.email_confirmed_at || 'NULL (미확인)'}`);
  console.log(`   created_at        = ${u.created_at}`);
  console.log(`   last_sign_in_at   = ${u.last_sign_in_at || 'NEVER'}`);
  console.log(`   banned_until      = ${u.banned_until || '-'}`);

  // ★ Identity 재검증: getUserById(id).email 서버 재확인
  const { data: byId, error: idErr } = await supabase.auth.admin.getUserById(u.id);
  if (idErr) { console.log(`   getUserById ERROR: ${idErr.message}`); }
  else {
    const idEmail = byId?.user?.email || null;
    const consistent = idEmail && idEmail.toLowerCase() === u.email.toLowerCase();
    console.log(`   getUserById.email = ${idEmail}  ${consistent ? '✅ 정합' : '❌ 불일치!'}`);
  }

  const { data: prof } = await supabase.from('user_profiles').select('*').eq('id', u.id).maybeSingle();
  console.log(`   user_profiles     = ${prof ? `name=${prof.name} role=${prof.role} approved=${prof.approved} active=${prof.active} clinic_id=${prof.clinic_id}` : '❌ none'}`);
  const { data: st } = await supabase.from('staff').select('*').eq('user_id', u.id).maybeSingle();
  console.log(`   staff             = ${st ? `id=${st.id} name=${st.name} role=${st.role} active=${st.active} clinic_id=${st.clinic_id}` : '❌ none'}`);
  console.log('');
}

// 판정 요약
const exactMatches = matches.filter(u => u.email.toLowerCase() === TARGET_EMAIL.toLowerCase());
console.log('=== 판정 ===');
console.log(`티켓 대상(${TARGET_EMAIL}) 정확일치: ${exactMatches.length}건`);
if (exactMatches.length === 0) console.log(`✅ 부재 → 신규 생성 진행 가능. clinic_id=${clinic.id}`);
else if (exactMatches.length > 1) console.log('⚠️ 다중매치 → ABORT + planner 에스컬 (duplicate)');
else console.log(`⚠️ 이미 존재 → 신규 생성 금지(duplicate). id=${exactMatches[0].id} reconcile + planner FOLLOWUP`);
