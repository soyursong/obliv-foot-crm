import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co','***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg',{auth:{persistSession:false}});
const CLINIC='74967aea-a60b-4da3-a0e7-9c997a930bc8', DATE='2026-06-09';
const { data: all } = await sb.from('reservations').select('id, reservation_time, visit_type, customer_name, customer_id, memo, created_by').eq('clinic_id',CLINIC).eq('reservation_date',DATE).order('reservation_time');
console.log(`6/9 jongno 잔여 예약: ${all?.length}건`);
const nullCnt=(all||[]).filter(r=>!r.customer_id).length;
console.log(`  customer_id NULL: ${nullCnt} (0이어야 격번 실패 종료)`);
const dummies=(all||[]).filter(r=>r.memo==='[TEST-DUMMY 20260609]');
console.log(`  더미(JONGNO) 카드: ${dummies.length}건, 전부 customer_id 직결 OPEN: ${dummies.every(r=>r.customer_id)}`);
if(nullCnt>0){console.log('  남은 NULL 행:'); (all||[]).filter(r=>!r.customer_id).forEach(r=>console.log(`    ${r.reservation_time?.slice(0,5)} ${r.visit_type} ${r.customer_name} created_by=${r.created_by||'-'}`));}
