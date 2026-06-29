/**
 * T-20260609-foot-DUMMY-RESV-JONGNO — CLEANUP (더미 30건 일괄 삭제)
 * 테스트 종료 후 실행. reservations 먼저, customers 나중.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const MARKER = '[TEST-DUMMY 20260609]';

const { data: rdel, error: re } = await sb.from('reservations').delete()
  .eq('clinic_id', CLINIC_ID).eq('reservation_date', '2026-06-09').eq('memo', MARKER).select('id');
console.log('reservations 삭제:', rdel?.length, 'err:', re);

const { data: cdel, error: ce } = await sb.from('customers').delete()
  .eq('clinic_id', CLINIC_ID).eq('is_simulation', true).eq('memo', MARKER).like('phone', '+82108809%').select('id');
console.log('customers 삭제:', cdel?.length, 'err:', ce);
console.log('=== CLEANUP DONE ===');
