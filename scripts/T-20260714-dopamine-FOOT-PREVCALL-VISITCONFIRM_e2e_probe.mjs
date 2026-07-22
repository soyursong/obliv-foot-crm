// T-20260714-dopamine-FOOT-PREVCALL-VISITCONFIRM-SYNC-RENAME — end-to-end verify probe
// dev-foot | FIX-REQUEST MSG-20260722-160716-9da3 (planner)
// Purpose: confirm columns exist + pick/snapshot a target reservation for the controlled synthetic-emit verify.
// Usage: node scripts/T-20260714-..._e2e_probe.mjs [reservationId]
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, key, { auth: { persistSession: false } });

const arg = process.argv[2];

async function main() {
  // 1) column existence (information_schema via RPC not available → probe by select)
  const { data: colProbe, error: colErr } = await admin
    .from('reservations')
    .select('id, clinic_id, visit_call_result, visit_call_result_at, visit_call_result_event_id')
    .limit(1);
  console.log('== column probe ==');
  if (colErr) { console.log('COLUMN_ERR', colErr.message); process.exit(2); }
  console.log('columns OK (visit_call_result/_at/_event_id selectable)');

  // 2) pick target reservation
  let target;
  if (arg) {
    const { data } = await admin.from('reservations')
      .select('id, clinic_id, customer_id, reservation_date, visit_call_result, visit_call_result_at, visit_call_result_event_id')
      .eq('id', arg).maybeSingle();
    target = data;
  } else {
    // prefer a dummy/test reservation if present, else most recent
    const { data } = await admin.from('reservations')
      .select('id, clinic_id, customer_id, reservation_date, visit_call_result, visit_call_result_at, visit_call_result_event_id')
      .order('created_at', { ascending: false })
      .limit(5);
    console.log('== recent 5 reservations (candidate pool) ==');
    (data||[]).forEach(r => console.log(JSON.stringify(r)));
    target = (data||[])[0];
  }
  console.log('== chosen target snapshot ==');
  console.log(JSON.stringify(target, null, 2));

  // 3) clinic slug for chosen clinic_id (for optional scope-guard payload)
  if (target?.clinic_id) {
    const { data: clinic } = await admin.from('clinics').select('id, slug, name').eq('id', target.clinic_id).maybeSingle();
    console.log('== clinic ==', JSON.stringify(clinic));
  }
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
