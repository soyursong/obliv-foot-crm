/**
 * T-20260630-dopamine-FOOTRESV-TM-EDIT-CANCEL — CANCEL 실패 RCA (READ-ONLY)
 * 현장 재현: "풋테스트tm" / 2026-07-10 10:00 풋케어 CANCEL → "풋센터 예약 저장 실패"
 * AC1: 예약 상태·source·lifecycle·external_id 확정
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SERVICE_ROLE_KEY env required'); })();
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

console.log('=== A. "풋테스트tm" 이름 매칭 예약 전체 ===');
const { data: byName, error: e1 } = await sb
  .from('reservations')
  .select('id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, status, source_system, external_id, visit_type, created_via, clinic_id, updated_at, created_at')
  .ilike('customer_name', '%풋테스트tm%')
  .order('reservation_date', { ascending: false });
if (e1) console.error('e1', e1);
console.log(JSON.stringify(byName, null, 2));

console.log('\n=== B. 2026-07-10 풋케어(전체 지점) 예약 ===');
const { data: byDate, error: e2 } = await sb
  .from('reservations')
  .select('id, customer_name, customer_phone, reservation_date, reservation_time, status, source_system, external_id, visit_type, clinic_id, updated_at')
  .eq('reservation_date', '2026-07-10')
  .order('reservation_time', { ascending: true });
if (e2) console.error('e2', e2);
console.log(JSON.stringify(byDate, null, 2));

console.log('\n=== C. check_ins lifecycle (byName 각 예약 대상) ===');
for (const r of (byName || [])) {
  const { data: ci } = await sb
    .from('check_ins')
    .select('id, status, checked_in_at, reservation_id')
    .eq('reservation_id', r.id);
  console.log(`resv ${r.id} (${r.reservation_date} ${r.reservation_time} status=${r.status} src=${r.source_system} ext=${r.external_id}) → check_ins:`, JSON.stringify(ci));
}

console.log('\n=== D. clinics 매핑 ===');
const { data: clinics } = await sb.from('clinics').select('id, slug, name');
console.log(JSON.stringify(clinics, null, 2));
