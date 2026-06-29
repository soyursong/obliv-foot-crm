/**
 * T-20260622-foot-STAFF-ACCOUNT-CREATE-3 — 김지현(치료사) AC-2 활성화 보정
 *
 * 접지(diag): 3명 모두 auth 계정·user_profiles·staff 존재, 전원 로그인 성공(last_sign_in 존재).
 *   이가연/김지윤(consultant) = active=true 정상. 김지현(therapist)만 active=FALSE → AC-2(활성) 위반.
 *
 * 본 스크립트: 김지현 staff.active / user_profiles.active 를 true 로 보정(state UPDATE, 비파괴·additive).
 *   동명이인 가드: 대상 user_id(diag 확인값)로만 한정. 이름만으로 일괄 변경 금지.
 *   role/clinic_id 는 손대지 않음(이미 therapist·풋센터 정합).
 *
 * 롤백: active=false 로 되돌리면 됨(rollback SQL 하단). 데이터 파괴 없음.
 *
 * 실행:
 *   DRY_RUN=true  node scripts/T-20260622-foot-STAFF-ACCOUNT-CREATE-3_kjh_activate.mjs
 *   DRY_RUN=false node scripts/T-20260622-foot-STAFF-ACCOUNT-CREATE-3_kjh_activate.mjs
 *
 * rollback SQL:
 *   UPDATE staff SET active=false WHERE user_id='3518b13d-86ee-44fb-bc29-8d2c3c6e0fbf';
 *   UPDATE user_profiles SET active=false WHERE id='3518b13d-86ee-44fb-bc29-8d2c3c6e0fbf';
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const TARGET_USER_ID = '3518b13d-86ee-44fb-bc29-8d2c3c6e0fbf'; // 김지현 oing_woo@naver.com (diag 확인)
const DRY_RUN = process.env.DRY_RUN !== 'false';

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// 동명이인 가드 — 이름으로 전체 조회 후 대상 user_id 일치 행만 확인
const { data: stByName } = await sb.from('staff').select('id,name,role,active,clinic_id,user_id').eq('name', '김지현');
console.log('staff name=김지현 전체 행:');
console.log(JSON.stringify(stByName, null, 2));
const target = (stByName || []).filter(r => r.user_id === TARGET_USER_ID);
if (target.length !== 1) { console.error(`❌ 대상 user_id 일치 staff 행이 ${target.length}건 — 중단(수동 확인 필요)`); process.exit(1); }
console.log(`\n대상 staff: id=${target[0].id} active=${target[0].active} role=${target[0].role}`);

if (DRY_RUN) {
  console.log('\n🔍 DRY-RUN — 변경 없음. 적용 예정:');
  console.log(`  · staff.active: ${target[0].active} → true (id=${target[0].id})`);
  console.log(`  · user_profiles.active → true (id=${TARGET_USER_ID})`);
  console.log('\n실제 적용: DRY_RUN=false node scripts/T-20260622-foot-STAFF-ACCOUNT-CREATE-3_kjh_activate.mjs');
  process.exit(0);
}

const { data: u1, error: e1 } = await sb.from('staff').update({ active: true }).eq('id', target[0].id).select();
if (e1) { console.error('❌ staff update 실패:', e1.message); process.exit(1); }
console.log('✅ staff.active=true:', JSON.stringify(u1));

const { data: u2, error: e2 } = await sb.from('user_profiles').update({ active: true }).eq('id', TARGET_USER_ID).select();
if (e2) { console.error('❌ user_profiles update 실패:', e2.message); process.exit(1); }
console.log('✅ user_profiles.active=true:', JSON.stringify(u2));

console.log('\n완료. AC-2 활성 충족.');
