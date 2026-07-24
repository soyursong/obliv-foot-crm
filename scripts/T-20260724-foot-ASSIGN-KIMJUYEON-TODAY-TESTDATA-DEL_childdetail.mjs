/** 서류테스트2(7f3f8b79) 추가 자식 상세 조사 (READ-ONLY) — planner 보고용 */
import { createClient } from '@supabase/supabase-js';
const supabase = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const CI = '7f3f8b79-eb3d-45f2-afab-205d52bc4a70';

const { data: sc } = await supabase.from('service_charges').select('*').eq('check_in_id', CI);
console.log('=== service_charges (2건) ===');
(sc ?? []).forEach((r) => console.log(JSON.stringify(r)));

const { data: ps } = await supabase.from('package_sessions').select('*').eq('check_in_id', CI);
console.log('\n=== package_sessions (1건) ===');
(ps ?? []).forEach((r) => console.log(JSON.stringify(r)));

const { data: aa } = await supabase.from('assignment_actions').select('*').eq('check_in_id', CI);
console.log('\n=== assignment_actions (2건) ===');
(aa ?? []).forEach((r) => console.log(JSON.stringify(r)));

// package_sessions 가 package 를 참조하면 그 package 도 확인
if ((ps ?? []).length) {
  const pkgId = ps[0].package_id;
  if (pkgId) {
    const { data: pkg } = await supabase.from('packages').select('*').eq('id', pkgId);
    console.log('\n=== 연결 package ===');
    (pkg ?? []).forEach((r) => console.log(JSON.stringify(r)));
    const { data: sib } = await supabase.from('package_sessions').select('id, check_in_id, session_no, status').eq('package_id', pkgId);
    console.log(`연결 package 의 전체 회차: ${(sib??[]).length}건`);
    (sib ?? []).forEach((r) => console.log(`   ${JSON.stringify(r)}`));
  }
}
