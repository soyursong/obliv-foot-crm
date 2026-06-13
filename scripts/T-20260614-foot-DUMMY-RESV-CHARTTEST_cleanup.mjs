/**
 * T-20260614-foot-DUMMY-RESV-CHARTTEST — CLEANUP (롤백)
 * 6/14 더미 24 reservations + 24 customers 제거. reservations → customers 순.
 * 식별: memo='[TEST-DUMMY 20260614]' + customers phone prefix +82108814 + is_simulation=true.
 */
import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const sb = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const MARKER = '[TEST-DUMMY 20260614]';

// reservations 먼저 (FK 자식)
const { data: rdel, error: re } = await sb.from('reservations').delete().eq('clinic_id', CLINIC_ID).eq('memo', MARKER).select('id');
if (re) { console.error('reservations delete fail', re); process.exit(1); }
console.log(`reservations 삭제: ${rdel?.length}건`);

// customers 다음 (memo + phone prefix + is_simulation 삼중 식별)
const { data: cdel, error: ce } = await sb.from('customers').delete().eq('clinic_id', CLINIC_ID).eq('memo', MARKER).eq('is_simulation', true).like('phone', '+82108814%').select('id');
if (ce) { console.error('customers delete fail', ce); process.exit(1); }
console.log(`customers 삭제: ${cdel?.length}건`);
console.log('CLEANUP DONE');

/* === 동등 SQL (참조용, reservations → customers 순) ===
DELETE FROM reservations
 WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
   AND memo = '[TEST-DUMMY 20260614]';
DELETE FROM customers
 WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
   AND memo = '[TEST-DUMMY 20260614]'
   AND is_simulation = true
   AND phone LIKE '+82108814%';
*/
