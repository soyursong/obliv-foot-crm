/**
 * T-20260713-foot-NAME-ALIAS-BACKFILL — Tier-A(ascii-alias) 3행 enrich (READ-ONLY)
 * is_simulation / dopamine 예약 상세 / 캐스케이드 대상 확인. UPDATE 없음.
 */
import { createClient } from '@supabase/supabase-js';
const supabase = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const IDS = [
  'ac65896b-ab76-49df-8992-582e51865abd', // Ok / 4470 (anchor=임○옥)
  '5bcf3bd9', '151fc672',
];
const tail = p => (p==null?null:(''+p).replace(/[^0-9]/g,'').slice(-4));
const rn = n => n==null?null:(/[가-힣]/.test(n)?`<${n.slice(0,1)}*len${n.length}>`:`<ASCII:${n}>`);

// resolve short ids
const { data: allc } = await supabase.from('customers')
  .select('id,name,phone,phone_dummy,is_simulation,lead_source,visit_type,created_at,updated_at,created_by')
  .or('id.eq.ac65896b-ab76-49df-8992-582e51865abd');
const { data: c2 } = await supabase.from('customers')
  .select('id,name,phone,phone_dummy,is_simulation,lead_source,visit_type,created_at,updated_at,created_by')
  .in('id', []); // placeholder

async function full(prefix){
  const { data } = await supabase.from('customers')
    .select('id,name,phone,phone_dummy,is_simulation,lead_source,visit_type,created_at,updated_at,created_by')
    .like('id', prefix+'%');
  return data||[];
}
const rows = [...(allc||[]), ...(await full('5bcf3bd9')), ...(await full('151fc672'))];
for (const c of rows){
  const { data: rs } = await supabase.from('reservations')
    .select('id,customer_name,customer_real_name,reservation_date,reservation_time,status,source_system,created_by,created_via,created_at')
    .eq('customer_id', c.id);
  console.log('─'.repeat(60));
  console.log(`customer ${c.id.slice(0,8)} | name=${rn(c.name)} | tail=${tail(c.phone)} | dummy=${c.phone_dummy} | is_simulation=${c.is_simulation} | visit_type=${c.visit_type} | lead_source=${c.lead_source??'NULL'}`);
  console.log(`  created=${c.created_at} updated=${c.updated_at} created_by=${c.created_by??'-'}`);
  for (const r of (rs||[])) console.log(`  resv ${r.id.slice(0,8)} | cust_name=${rn(r.customer_name)} | real_name=${rn(r.customer_real_name)} | date=${r.reservation_date} ${r.reservation_time||''} | status=${r.status} | src=${r.source_system} | via=${r.created_via??'-'}`);
}
