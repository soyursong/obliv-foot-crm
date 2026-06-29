/**
 * T-20260615-foot-DUMMY-RESV-CHARTOPEN-VERIFY — CLEANUP (롤백)
 * 6/15 더미 32 reservations + 32 customers 제거. reservations → customers 순(FK 역순).
 * 키(티켓 의무): created_by='TEST-20260615'
 *   - reservations: clinic_id + created_by + reservation_date='2026-06-15'
 *   - customers   : clinic_id + created_by + phone LIKE '+82108615%'
 *     (더미는 is_simulation=false로 적재되므로 is_simulation 키 사용 금지 — created_by+phone로 식별)
 * ⚠ 실데이터는 created_by/phone 마커 불일치로 영향 없음.
 */
import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',(process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })()),{auth:{persistSession:false}});
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const DATE = '2026-06-15';
const CREATED_BY = 'TEST-20260615';

// reservations 먼저 (FK 자식)
const { data: rdel, error: re } = await sb.from('reservations').delete().eq('clinic_id', CLINIC_ID).eq('created_by', CREATED_BY).eq('reservation_date', DATE).select('id');
if (re) { console.error('reservations delete fail', re); process.exit(1); }
console.log(`reservations 삭제: ${rdel?.length}건`);

// customers 다음 (created_by + phone prefix 이중 식별 — 둘 다 본 티켓 고유)
const { data: cdel, error: ce } = await sb.from('customers').delete().eq('clinic_id', CLINIC_ID).eq('created_by', CREATED_BY).like('phone', '+82108615%').select('id');
if (ce) { console.error('customers delete fail', ce); process.exit(1); }
console.log(`customers 삭제: ${cdel?.length}건`);
console.log('CLEANUP DONE');

/* === 동등 SQL (참조용, reservations → customers 순) ===
BEGIN;
DELETE FROM reservations
 WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
   AND created_by = 'TEST-20260615'
   AND reservation_date = '2026-06-15';
DELETE FROM customers
 WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
   AND created_by = 'TEST-20260615'
   AND phone LIKE '+82108615%';
COMMIT;
*/
