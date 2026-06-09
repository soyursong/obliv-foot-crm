/**
 * T-20260609-foot-DUMMY-RESV-JONGNO — INSPECT (READ-ONLY)
 * GO_WARN 의무 1) INSERT 전 clinic_id·스키마 확인
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = '***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

console.log('=== 1. clinics 행 검증 (clinic_id 74967aea / jongno-foot) ===');
const { data: clinics, error: ce } = await sb
  .from('clinics')
  .select('*')
  .ilike('id', '74967aea%');
if (ce) console.error('clinics err', ce);
console.log('ilike 74967aea% →', JSON.stringify(clinics, null, 2));

const { data: bySlug } = await sb.from('clinics').select('*').eq('slug', 'jongno-foot');
console.log('slug=jongno-foot →', JSON.stringify(bySlug, null, 2));

const { data: allClinics } = await sb.from('clinics').select('id, slug, name');
console.log('전체 clinics:', JSON.stringify(allClinics, null, 2));

console.log('\n=== 2. reservations 스키마 (샘플 1건 컬럼) ===');
const { data: rsample } = await sb.from('reservations').select('*').limit(1);
console.log('reservations 컬럼:', rsample?.[0] ? Object.keys(rsample[0]) : 'NO ROWS');
console.log('샘플:', JSON.stringify(rsample?.[0], null, 2));

console.log('\n=== 3. customers 스키마 (샘플 1건 컬럼) ===');
const { data: csample } = await sb.from('customers').select('*').limit(1);
console.log('customers 컬럼:', csample?.[0] ? Object.keys(csample[0]) : 'NO ROWS');
console.log('샘플:', JSON.stringify(csample?.[0], null, 2));

console.log('\n=== 4. visit_type 분포 (구분 방식 확인) ===');
const { data: vtypes } = await sb.from('reservations').select('visit_type').limit(2000);
const vmap = {};
(vtypes||[]).forEach(r => { vmap[r.visit_type] = (vmap[r.visit_type]||0)+1; });
console.log('reservations.visit_type 분포:', JSON.stringify(vmap, null, 2));

const { data: cvtypes } = await sb.from('customers').select('visit_type').limit(2000);
const cvmap = {};
(cvtypes||[]).forEach(r => { cvmap[r.visit_type] = (cvmap[r.visit_type]||0)+1; });
console.log('customers.visit_type 분포:', JSON.stringify(cvmap, null, 2));

console.log('\n=== 5. status 분포 (reservations) ===');
const { data: statuses } = await sb.from('reservations').select('status').limit(2000);
const smap = {};
(statuses||[]).forEach(r => { smap[r.status] = (smap[r.status]||0)+1; });
console.log('reservations.status 분포:', JSON.stringify(smap, null, 2));

console.log('\n=== 6. jongno-foot 기존 오늘(2026-06-09) 예약 건수 ===');
const CLINIC_ID = clinics?.[0]?.id || bySlug?.[0]?.id;
console.log('확정 clinic_id:', CLINIC_ID);
if (CLINIC_ID) {
  const { data: today } = await sb.from('reservations').select('id, reservation_time, visit_type, customer_name')
    .eq('clinic_id', CLINIC_ID).eq('reservation_date', '2026-06-09');
  console.log(`오늘 기존 예약: ${today?.length || 0}건`);
}

console.log('\n=== 7. is_simulation 컬럼 존재 여부 (customers/reservations) ===');
console.log('customers has is_simulation:', csample?.[0] && 'is_simulation' in csample[0]);
console.log('reservations has is_simulation:', rsample?.[0] && 'is_simulation' in rsample[0]);
