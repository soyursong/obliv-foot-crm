/**
 * T-20260713-foot-COUNSELOR-ACCT-CREATE-FACEOFANGEL — STEP 1 진단 (SELECT-only)
 *
 * 상담실장 김지윤 로그인 불가 복구 건.
 * 티켓 대상 이메일: faceofangel9999@oblivseoul.kr
 * 선행 RC(T-20260622): 06-09 self-signup 계정 email_confirmed_at=NULL → "Email not confirmed"
 *   ※ 단, T-20260622 진단서는 김지윤 이메일을 faceofangel9999@GMAIL.com 으로 기록.
 *   → 티켓 도메인(@oblivseoul.kr) 과 불일치 가능성 → 반드시 실제 auth row 로 재해소.
 *
 * 목적: 어떤 계정이 실재하는지, id↔email 정합, 다중매치 여부를 파괴 없이 확정.
 * 읽기 전용. UPDATE/INSERT/DELETE 없음.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })());
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const NEEDLE = 'faceofangel9999';
const TICKET_EMAIL = 'faceofangel9999@oblivseoul.kr';

// 전체 auth.users 로드 → needle 매치 전수 수집 (?email= 서버필터 단독 신뢰 금지)
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
  const exact = u.email.toLowerCase() === TICKET_EMAIL.toLowerCase();
  console.log(`── auth user ${u.id}`);
  console.log(`   email             = ${u.email}  ${exact ? '★티켓대상 정확일치' : '(도메인 상이)'}`);
  console.log(`   email_confirmed_at= ${u.email_confirmed_at || 'NULL (미확인)'}`);
  console.log(`   created_at        = ${u.created_at}`);
  console.log(`   last_sign_in_at   = ${u.last_sign_in_at || 'NEVER'}`);
  console.log(`   banned_until      = ${u.banned_until || '-'}`);

  // ★ Identity 재검증: getUserById(id).email 이 리스트의 email 과 동일한지 서버 재확인
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
const exactMatches = matches.filter(u => u.email.toLowerCase() === TICKET_EMAIL.toLowerCase());
console.log('=== 판정 ===');
console.log(`티켓 대상(${TICKET_EMAIL}) 정확일치: ${exactMatches.length}건`);
if (exactMatches.length === 0) console.log('⚠️ 정확일치 0 → 도메인 불일치. planner 에스컬 후보 (추측 UPDATE 금지)');
else if (exactMatches.length > 1) console.log('⚠️ 다중매치 → ABORT + planner 에스컬');
else console.log(`✅ 단일 정확일치 → 대상 id=${exactMatches[0].id} freeze 후 복구 진행 가능`);
