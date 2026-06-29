/** REAPPLY VALIDATE — test 1 insert(is_simulation=false)+delete, prod 흔적 0 */
import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',(process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })()),{auth:{persistSession:false}});
const CLINIC_ID='74967aea-a60b-4da3-a0e7-9c997a930bc8';const MARKER='[TEST-DUMMY 20260610-REAPPLY]';
const {data:cust,error:ce}=await sb.from('customers').insert({clinic_id:CLINIC_ID,name:'검증임시0610R',phone:'+821088119999',visit_type:'new',is_simulation:false,memo:MARKER}).select('id,name,chart_number,phone,is_simulation').single();
if(ce){console.error('CUSTOMER INSERT FAIL:',ce);process.exit(1);}
console.log('CUSTOMER OK:',JSON.stringify(cust));
const {data:resv,error:re}=await sb.from('reservations').insert({clinic_id:CLINIC_ID,customer_id:cust.id,customer_name:'검증임시0610R',customer_phone:'+821088119999',reservation_date:'2026-06-10',reservation_time:'12:00:00',visit_type:'new',status:'confirmed',memo:MARKER}).select('id,customer_id,visit_type,status').single();
if(re){console.error('RESERVATION INSERT FAIL:',re);await sb.from('customers').delete().eq('id',cust.id);console.log('rolled back customer');process.exit(1);}
console.log('RESERVATION OK:',JSON.stringify(resv));
const {error:dre}=await sb.from('reservations').delete().eq('id',resv.id);
const {error:dce}=await sb.from('customers').delete().eq('id',cust.id);
console.log('CLEANUP resv del err:',dre,'| cust del err:',dce);
console.log('=== VALIDATE PASS (is_simulation=false 허용 + customer_id 직결 확인) ===');
