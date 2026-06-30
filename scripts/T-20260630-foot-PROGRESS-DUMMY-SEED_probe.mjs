import { createClient } from '@supabase/supabase-js';
const URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY required');
const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // jongno-foot
const DATE = '2026-06-30';

// 1) reservations 컬럼 존재 확인 (progress_check_required/label + is_simulation)
const probeCols = 'id, customer_id, customer_name, reservation_date, reservation_time, visit_type, status, memo, registrar_name, progress_check_required, progress_check_label';
let hasIsSim = true;
{
  const { error } = await sb.from('reservations').select('is_simulation').limit(1);
  hasIsSim = !error;
  console.log('reservations.is_simulation column:', hasIsSim ? 'EXISTS' : `ABSENT (${error?.message})`);
}
{
  const { error } = await sb.from('reservations').select(probeCols).limit(1);
  console.log('progress_check cols probe:', error ? `ERROR ${error.message}` : 'OK (columns exist)');
}

// 2) 재사용 가능한 is_simulation 더미 고객 (jongno)
{
  const { data, error } = await sb.from('customers')
    .select('id,name,phone,is_simulation,memo,chart_number')
    .eq('clinic_id', CLINIC_ID).eq('is_simulation', true)
    .order('created_at', { ascending: false }).limit(20);
  console.log('\nexisting sim customers (jongno):', error ? error.message : data.length);
  (data||[]).forEach(c => console.log(`  ${c.id} | ${c.name} | chart=${c.chart_number||'-'} | memo=${c.memo||'-'}`));
}

// 3) 6/30 현재 progress 대상 (dedup)
{
  const { data, error } = await sb.from('reservations')
    .select('id,customer_name,reservation_time,progress_check_label,status,is_simulation')
    .eq('clinic_id', CLINIC_ID).eq('reservation_date', DATE)
    .eq('progress_check_required', true).neq('status','cancelled');
  console.log(`\n6/30 progress rows now: ${error?error.message:(data?.length??0)}`);
  (data||[]).forEach(r => console.log(`  ${r.id} | ${r.customer_name} | ${r.reservation_time} | ${r.progress_check_label} | sim=${r.is_simulation}`));
}

// 4) reservations 한 행 샘플 (NOT NULL 필수컬럼 파악)
{
  const { data } = await sb.from('reservations').select('*').eq('clinic_id',CLINIC_ID).limit(1);
  if (data?.[0]) console.log('\nsample reservation keys:', Object.keys(data[0]).join(', '));
}
