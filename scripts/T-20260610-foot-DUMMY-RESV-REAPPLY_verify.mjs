/** REAPPLY VERIFY — AC-1/AC-2/AC-3 data-level: admin filter path 생존 + 명단 parity + NULL/visit_type */
import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',(process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })()),{auth:{persistSession:false}});
const C='74967aea-a60b-4da3-a0e7-9c997a930bc8';const D='2026-06-10';const M='[TEST-DUMMY 20260610-REAPPLY]';

// admin/self-checkin 공통 원천: reservations (date+clinic 전체)
const {data:allResv}=await sb.from('reservations').select('id,customer_id,customer_name,reservation_time,visit_type,memo').eq('clinic_id',C).eq('reservation_date',D);
const ours=allResv.filter(r=>r.memo===M);
console.log('reservations 원천(전체 6/10 jongno):',allResv.length,'| 우리 REAPPLY:',ours.length);

// stripSimulationRows 재현 (admin surface) — is_simulation=true 고객만 제거
const ids=[...new Set(allResv.map(r=>r.customer_id).filter(Boolean))];
const {data:sim}=await sb.from('customers').select('id').in('id',ids).eq('is_simulation',true);
const simSet=new Set((sim||[]).map(c=>c.id));
const adminVisible=allResv.filter(r=>!r.customer_id||!simSet.has(r.customer_id));
const oursVisibleAdmin=adminVisible.filter(r=>r.memo===M);
console.log('[AC-1 admin] sim-filter 후 우리 더미 생존:',oursVisibleAdmin.length,'/24');

// self-checkin surface = 동일 reservations 원천(필터 동일 로직) → parity by construction
// 명단 집합(이름) 비교
const adminNames=new Set(oursVisibleAdmin.map(r=>r.customer_name));
const rawNames=new Set(ours.map(r=>r.customer_name));
console.log('[AC-1 parity] admin 명단:',adminNames.size,'| raw 명단:',rawNames.size,'| 일치:',adminNames.size===rawNames.size && [...rawNames].every(n=>adminNames.has(n)));

// AC-2 customer_id NULL
console.log('[AC-2] customer_id NULL 건:',ours.filter(r=>!r.customer_id).length,'(기대 0)');

// AC-3 new/returning
const nNew=ours.filter(r=>r.visit_type==='new').length, nRet=ours.filter(r=>r.visit_type==='returning').length;
console.log('[AC-3] new:',nNew,'| returning:',nRet,'(각 12 기대)');

// customers is_simulation 분포
const {data:cust}=await sb.from('customers').select('id,is_simulation,visit_type').eq('clinic_id',C).eq('memo',M);
console.log('[customers] 총:',cust.length,'| is_simulation=true:',cust.filter(c=>c.is_simulation===true).length,'(반드시 0) | false:',cust.filter(c=>c.is_simulation===false).length);
