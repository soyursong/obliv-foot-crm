import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co','***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg',{auth:{persistSession:false}});
const CLINIC='74967aea-a60b-4da3-a0e7-9c997a930bc8', DATE='2026-06-09';
const { data: all } = await sb.from('reservations').select('id, reservation_time, visit_type, customer_name, customer_id, created_by, memo').eq('clinic_id',CLINIC).eq('reservation_date',DATE).order('reservation_time');
console.log(`6/9 jongno 전체 예약: ${all?.length}건`);
const byMarker={};
(all||[]).forEach(r=>{const k=r.created_by||`memo:${r.memo}`; byMarker[k]=byMarker[k]||{n:0,cidSet:0}; byMarker[k].n++; if(r.customer_id) byMarker[k].cidSet++;});
console.log('마커별 분포:'); Object.entries(byMarker).forEach(([k,v])=>console.log(`  ${k} → ${v.n}건 (customer_id SET: ${v.cidSet})`));
// JONGNO 배치 예약(memo 마커)이 실제로 customer_id 연결됐는지
const jongno=(all||[]).filter(r=>r.memo==='[TEST-DUMMY 20260609]');
console.log(`\nJONGNO(memo='[TEST-DUMMY 20260609]') 예약: ${jongno.length}건, customer_id SET ${jongno.filter(r=>r.customer_id).length}건`);
