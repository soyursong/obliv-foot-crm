/**
 * T-20260610-foot-DUMMY-RESV-CHARTVERIFY — VALIDATE (test insert 1 customer + 1 reservation, then DELETE)
 * 필수 NOT NULL/CHECK 컬럼 검증용. prod에 흔적 남기지 않음.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const MARKER = '[TEST-DUMMY 20260610]';

const { data: cust, error: ce } = await sb.from('customers').insert({
  clinic_id: CLINIC_ID, name: '검증임시0610', phone: '+821088109999',
  visit_type: 'new', is_simulation: true, memo: MARKER,
}).select('id, name, chart_number, phone').single();
if (ce) { console.error('CUSTOMER INSERT FAIL:', ce); process.exit(1); }
console.log('CUSTOMER OK:', JSON.stringify(cust));

const { data: resv, error: re } = await sb.from('reservations').insert({
  clinic_id: CLINIC_ID, customer_id: cust.id, customer_name: '검증임시0610',
  customer_phone: '+821088109999', reservation_date: '2026-06-10',
  reservation_time: '12:00:00', visit_type: 'new', status: 'confirmed', memo: MARKER,
}).select('id, customer_id, customer_name, reservation_time, visit_type, status').single();
if (re) {
  console.error('RESERVATION INSERT FAIL:', re);
  await sb.from('customers').delete().eq('id', cust.id);
  console.log('rolled back customer');
  process.exit(1);
}
console.log('RESERVATION OK:', JSON.stringify(resv));

const { error: dre } = await sb.from('reservations').delete().eq('id', resv.id);
const { error: dce } = await sb.from('customers').delete().eq('id', cust.id);
console.log('CLEANUP reservation del err:', dre, '| customer del err:', dce);
console.log('=== VALIDATE PASS: 필수 컬럼(customer_id 직결 + visit_type new) 충족 확인 ===');
