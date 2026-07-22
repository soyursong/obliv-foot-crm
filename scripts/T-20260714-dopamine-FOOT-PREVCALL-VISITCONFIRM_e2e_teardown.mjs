// Teardown: delete the dedicated dummy reservation + customer created for the verify.
import { createClient } from '@supabase/supabase-js';
const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const RID = 'd4edf610-eb6a-4ba8-add5-cafb9c574fba';
const CID = '5d2e26c1-6a17-412f-85d9-3015c269e032';
const { error: re } = await admin.from('reservations').delete().eq('id', RID);
const { error: ce } = await admin.from('customers').delete().eq('id', CID);
console.log('reservation delete err:', re?.message ?? 'OK');
console.log('customer delete err:', ce?.message ?? 'OK');
// verify gone
const { data: r } = await admin.from('reservations').select('id').eq('id', RID).maybeSingle();
const { data: c } = await admin.from('customers').select('id').eq('id', CID).maybeSingle();
console.log('reservation remaining:', r ? 'STILL PRESENT ❌' : 'gone ✅');
console.log('customer remaining:', c ? 'STILL PRESENT ❌' : 'gone ✅');
