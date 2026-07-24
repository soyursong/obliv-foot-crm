/**
 * STEP 02 — 박민석 배정 이력 대상 특정용 compact 뷰 (READ-ONLY)
 * 동명이인 가드 발동(customers 2건 / check_ins 5건) → 대상 disambiguation 근거 수집.
 */
import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: ci } = await sb.from('check_ins')
  .select('id, customer_id, customer_name, customer_phone, chart:customer_id, visit_type, status, consultant_id, therapist_id, created_date, checked_in_at, reservation_id, queue_number')
  .eq('customer_name', '박민석').order('created_at', { ascending: false });

// customer chart 매핑
const custIds = [...new Set(ci.map(r => r.customer_id))];
const { data: custs } = await sb.from('customers')
  .select('id, chart_number, phone, is_simulation, created_at').in('id', custIds);
const cmap = new Map(custs.map(c => [c.id, c]));

console.log('=== 박민석 check_ins (배정 이력 후보) — compact ===');
for (const r of ci) {
  const c = cmap.get(r.customer_id) || {};
  console.log(JSON.stringify({
    check_in_id: r.id,
    chart: c.chart_number, phone: r.customer_phone, is_sim: c.is_simulation,
    visit_type: r.visit_type, status: r.status,
    consultant_id: r.consultant_id, therapist_id: r.therapist_id,
    date: r.created_date, checked_in_at: r.checked_in_at,
    reservation_id: r.reservation_id, queue: r.queue_number,
  }));
}

// 박민석 staff (배정 대상자였을 가능성) 확인
const { data: st } = await sb.from('staff').select('id, name, role, active').eq('name', '박민석');
console.log('\n=== staff name=박민석 ===\n' + JSON.stringify(st, null, 2));

// 박민석 관련 reservations (배정 이력이 예약 grain일 수 있음)
const { data: rv } = await sb.from('reservations')
  .select('id, customer_id, customer_name, reservation_date, reservation_time, status, source_system')
  .eq('customer_name', '박민석').order('reservation_date', { ascending: false });
console.log('\n=== reservations name=박민석 (count=' + (rv?.length ?? 0) + ') ===\n' + JSON.stringify(rv, null, 2));
