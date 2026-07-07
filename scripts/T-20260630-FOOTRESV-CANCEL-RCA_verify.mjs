/**
 * T-20260630 CANCEL RCA — 픽스 검증 (NON-MUTATING)
 *  A) 재현: p_reservation_date='T+09:00' → PostgREST 경계 캐스팅 실패(원 500 원인 확인)
 *  B) 픽스: 유효 date + 매칭 없는 external_id → RETURN NULL(캐스팅 통과, 무변경)
 *  실 예약(20b6a1c6, 풋테스트tm)은 confirmed 그대로 둔다(dev-dopamine 실 write CANCEL E2E 대상).
 */
import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const base = {
  p_source_system: 'dopamine', p_clinic_slug: 'jongno-foot',
  p_customer_phone: null, p_customer_name: 'rca-probe',
  p_reservation_time: '10:00:00', p_status: 'cancelled',
  p_visit_type: 'new', p_created_via: 'dopamine',
  p_service_id: null, p_registrar_id: null, p_registrar_name: null,
  p_customer_real_name: null, p_customer_real_phone: null, p_is_companion: false,
};

console.log('=== A) 재현: 잘못된 date "T+09:00" (원 500 RC) ===');
const a = await sb.rpc('upsert_reservation_from_source', {
  ...base, p_external_id: 'rca-nomatch-'+'A', p_reservation_date: 'T+09:00',
});
console.log('  error:', a.error ? `${a.error.code} ${a.error.message}` : 'NONE', '| data:', a.data);

console.log('\n=== B) 픽스: 유효 date "2026-07-10" + 매칭없는 external_id → NULL no-op ===');
const b = await sb.rpc('upsert_reservation_from_source', {
  ...base, p_external_id: 'rca-nomatch-'+'B', p_reservation_date: '2026-07-10',
});
console.log('  error:', b.error ? `${b.error.code} ${b.error.message}` : 'NONE', '| data:', b.data, '(NULL=미발견 no-op, 캐스팅 통과)');

console.log('\n=== C) 실 예약 상태 재확인 (불변 확인) ===');
const { data: r } = await sb.from('reservations')
  .select('id,status,reservation_date,reservation_time,source_system,external_id')
  .eq('id', '20b6a1c6-d8b0-46b9-aaac-9aa34b09551c').maybeSingle();
console.log(' ', JSON.stringify(r));
