// READ-ONLY census — T-20260818-foot-CONSULT-WAITING-INFLOW-ETC-MISLABEL
// 도건민(F-6244) 유입경로 저장축 실측: customers.visit_route / first_inflow_channel / 당일 check_in inflow_channel
// + system_codes inflow_channel 라벨(inbound.etc → '기타...') 대조. NO WRITE.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });

console.log('=== 1) customers: 차트번호 F-6244 / 이름 도건민 ===');
let { data: byChart } = await sb.from('customers')
  .select('id, name, chart_number, visit_route, lead_source, first_inflow_channel, first_inflow_source_ref, created_at')
  .or('chart_number.eq.F-6244,chart_number.eq.6244,name.eq.도건민');
console.log(JSON.stringify(byChart, null, 2));

const cust = (byChart || []).find(c => c.name === '도건민') || (byChart || [])[0];
if (cust) {
  console.log('\n=== 2) 당일 check_ins (해당 고객) inflow_channel ===');
  const { data: ci } = await sb.from('check_ins')
    .select('id, customer_id, customer_name, inflow_channel, visit_type, status, consult_notify_status, checked_in_at, reservation_id')
    .eq('customer_id', cust.id)
    .order('checked_in_at', { ascending: false })
    .limit(5);
  console.log(JSON.stringify(ci, null, 2));

  const resvId = (ci || []).find(c => c.reservation_id)?.reservation_id;
  if (resvId) {
    console.log('\n=== 2b) 관련 reservation source_system ===');
    const { data: rv } = await sb.from('reservations').select('id, source_system, created_at').eq('id', resvId);
    console.log(JSON.stringify(rv, null, 2));
  }
}

console.log('\n=== 3) system_codes inflow_channel 라벨(inbound.* 전부) ===');
const { data: codes } = await sb.from('system_codes')
  .select('code, label, code_type')
  .eq('code_type', 'inflow_channel');
console.log(JSON.stringify(codes, null, 2));
