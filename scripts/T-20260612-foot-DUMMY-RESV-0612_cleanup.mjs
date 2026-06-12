/**
 * T-20260612-foot-DUMMY-RESV-0612 — CLEANUP (롤백)
 * 6/12 더미 52 reservations + 52 customers 제거. reservations → customers 순.
 * ⚠ is_simulation=false 사용했으므로 customers는 memo 마커 + phone prefix(+82108812)로 식별.
 *   (티켓 AC-6 원안의 is_simulation=true 키는 본 배치엔 매칭 안 됨 — 편차 보고됨)
 */
import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = '***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const sb = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const MARKER = '[TEST-DUMMY 20260612]';

const { data: rdel, error: re } = await sb.from('reservations').delete().eq('clinic_id', CLINIC_ID).eq('memo', MARKER).select('id');
if (re) { console.error('reservations delete fail', re); process.exit(1); }
console.log(`reservations 삭제: ${rdel?.length}건`);

const { data: cdel, error: ce } = await sb.from('customers').delete().eq('clinic_id', CLINIC_ID).eq('memo', MARKER).like('phone', '+82108812%').select('id');
if (ce) { console.error('customers delete fail', ce); process.exit(1); }
console.log(`customers 삭제: ${cdel?.length}건`);
console.log('CLEANUP DONE');
