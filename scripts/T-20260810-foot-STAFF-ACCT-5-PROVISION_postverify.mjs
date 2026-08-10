import { createClient } from '@supabase/supabase-js';
const supabase = createClient('https://rxlomoozakkjesdqjtvd.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const lc = (s) => (s || '').trim().toLowerCase();
const TARGETS = [
  ['게스트','footcare@oblivseoul.kr'],['강다연','ekdusrkd1@naver.com'],['이진석','naspos82@gmail.com'],
  ['황수진','hwang5679@gmail.com'],['한예슬','dptmf316@gmail.com'],
];
// auth 전량 로드
const byEmail = new Map(); let page = 1;
while (true) { const { data } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
  if (!data?.users?.length) break; for (const u of data.users) if (u.email) byEmail.set(lc(u.email), u);
  if (data.users.length < 1000) break; page++; }

console.log('── AC-2/AC-4: 5계정 상태 ──');
for (const [nm, em] of TARGETS) {
  const u = byEmail.get(lc(em));
  const { data: prof } = await supabase.from('user_profiles').select('role,approved,active,clinic_id').eq('id', u.id).maybeSingle();
  console.log(`[${nm}] ${em}\n   auth uid=${u.id} | email_confirmed=${u.email_confirmed_at ? 'Y' : 'N'} | last_sign_in=${u.last_sign_in_at || '없음(미로그인)'} | banned=${u.banned_until || 'no'}`);
  console.log(`   profile: role=${prof?.role} approved=${prof?.approved} active=${prof?.active} clinic=${prof?.clinic_id ? 'OK' : 'NULL'}`);
}

console.log('\n── AC-3: dedup 결과 (active staff row count) ──');
for (const nm of ['한예슬','황수진']) {
  const { data: rows } = await supabase.from('staff').select('id,active,user_id').eq('name', nm);
  const act = rows.filter(r => r.active);
  console.log(`  [${nm}] 총 ${rows.length}행 | active ${act.length}행 (기대=1) | active row user_id=${act.map(r=>r.user_id?'有':'NULL').join(',')}`);
}
