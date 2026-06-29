/** REAPPLY CLEANUP — 더미 전량 회수 (reservations→customers, memo+phone 2중 마커) */
import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',(process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })()),{auth:{persistSession:false}});
const C='74967aea-a60b-4da3-a0e7-9c997a930bc8';const M='[TEST-DUMMY 20260610-REAPPLY]';
const {data:r,error:re}=await sb.from('reservations').delete().eq('memo',M).eq('clinic_id',C).select('id');
console.log('reservations 삭제:',r?.length,'err:',re);
const {data:c,error:ce}=await sb.from('customers').delete().eq('memo',M).like('phone','+82108811%').select('id');
console.log('customers 삭제:',c?.length,'err:',ce);
console.log('=== CLEANUP DONE ===');
