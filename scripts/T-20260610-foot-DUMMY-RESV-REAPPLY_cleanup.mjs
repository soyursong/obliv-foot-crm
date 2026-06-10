/** REAPPLY CLEANUP — 더미 전량 회수 (reservations→customers, memo+phone 2중 마커) */
import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg',{auth:{persistSession:false}});
const C='74967aea-a60b-4da3-a0e7-9c997a930bc8';const M='[TEST-DUMMY 20260610-REAPPLY]';
const {data:r,error:re}=await sb.from('reservations').delete().eq('memo',M).eq('clinic_id',C).select('id');
console.log('reservations 삭제:',r?.length,'err:',re);
const {data:c,error:ce}=await sb.from('customers').delete().eq('memo',M).like('phone','+82108811%').select('id');
console.log('customers 삭제:',c?.length,'err:',ce);
console.log('=== CLEANUP DONE ===');
