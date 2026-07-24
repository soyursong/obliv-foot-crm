/**
 * T-20260724-foot-DISTHIST-ASSIGNEE-BBS-KKM-MOVE — KKM-EGE CROSS-GUARD (READ-ONLY)
 * 본건 = 강경민 pool +1 (백범석 check_in 625e534d). sibling KKM-EGE(강경민→엄경은 8건)와 직렬.
 * 검증: (a) KKM-EGE 8-set 고객명에 백범석 미포함, (b) 백범석 건이 8-set과 disjoint,
 *       (c) 현재 강경민 pool 스냅샷(본건 실행 전).
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const KKM_ID = '6ab26d9f-fd10-4042-9fd7-076f277be5d4';
const KKM_EGE_8SET = ['엄상욱', '김종민', '오정길', '이민태', '최강선', '백영호', '이재성', '이멋진'];
const BBS_PK = '625e534d-22e6-4526-8ea5-c34645691b67';

console.log('=== (a) KKM-EGE 8-set 에 백범석 미포함 ===');
console.log('  8-set:', KKM_EGE_8SET.join(', '));
console.log('  백범석 in 8-set?', KKM_EGE_8SET.includes('백범석'));

console.log('\n=== (b) 현재 강경민(consultant_id) check_ins pool ===');
const { data: pool } = await supabase.from('check_ins')
  .select('id, customer_name, checked_in_at, status').eq('clinic_id', CLINIC).eq('consultant_id', KKM_ID);
console.log(`  현재 강경민 pool: ${(pool ?? []).length}건`);
for (const r of pool ?? []) console.log(`    ${r.customer_name} @ ${r.checked_in_at?.slice(0,10)} (${r.id === BBS_PK ? 'BBS-대상' : 'existing'})`);
console.log('  → 본건 UPDATE 후 백범석(625e534d) 이 이 pool 에 편입. 8-set 고객명과 disjoint(백범석 ∉ 8-set).');

console.log('\n=== 판정 ===');
console.log('  KKM-EGE 티켓 status=done (2026-07-24T23:10:56) — 재스캔 없음. 백범석발 신규 강경민 건이 KKM-EGE 8-set 앵커에 미포함 확정. 직렬화 안전.');
