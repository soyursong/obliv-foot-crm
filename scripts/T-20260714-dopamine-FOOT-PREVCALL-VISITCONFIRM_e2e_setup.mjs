// Create a dedicated dummy reservation for the controlled synthetic-emit verify. Prints its id.
import { createClient } from '@supabase/supabase-js';
const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const MARKER = '[E2E-VISITCALL-VERIFY 20260722]';
const TOKEN = process.argv[2] || 'run0';

const { data: cust, error: ce } = await admin.from('customers')
  .insert({ clinic_id: CLINIC, name: 'E2E검증더미', phone: '+821000000000', visit_type: 'new', is_simulation: true, memo: MARKER })
  .select('id').single();
if (ce) { console.error('CUST_FAIL', ce); process.exit(1); }

const { data: resv, error: re } = await admin.from('reservations')
  .insert({ clinic_id: CLINIC, customer_id: cust.id, customer_name: 'E2E검증더미', customer_phone: '+821000000000',
            reservation_date: '2026-07-23', reservation_time: '11:00:00', visit_type: 'new', status: 'confirmed', memo: MARKER })
  .select('id, visit_call_result, visit_call_result_at, visit_call_result_event_id').single();
if (re) { await admin.from('customers').delete().eq('id', cust.id); console.error('RESV_FAIL', re); process.exit(1); }

console.log(JSON.stringify({ customer_id: cust.id, reservation_id: resv.id, run_token: TOKEN, initial: resv }, null, 2));
