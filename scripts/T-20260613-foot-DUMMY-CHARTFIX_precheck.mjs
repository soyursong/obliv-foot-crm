/**
 * T-20260613-foot-DUMMY-CHARTFIX — cleanup 전 안전 점검 (read-only)
 *  - 한국어 마커("테스트 더미","[테스트더미]") 고아 customers 존재 여부 (다른 날짜 영향 점검)
 *  - 6/13 비더미 4건(실데이터) 보존 확인
 */
import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',
  (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })()),
  { auth: { persistSession: false } });
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const DATE = '2026-06-13';
const MARKERS = ['테스트 더미', '[테스트더미]'];

// 1) 해당 마커 reservations가 6/13 외 다른 날짜에도 있는지 (삭제 범위 안전성)
for (const m of MARKERS) {
  const { data: all } = await sb.from('reservations').select('reservation_date').eq('clinic_id', CLINIC_ID).eq('memo', m);
  const byDate = {}; (all||[]).forEach(r=>byDate[r.reservation_date]=(byDate[r.reservation_date]||0)+1);
  console.log(`memo="${m}" reservations 날짜분포:`, JSON.stringify(byDate));
}

// 2) 한국어 마커 customers 존재 여부 (고아)
for (const m of MARKERS) {
  const { data: c } = await sb.from('customers').select('id, name, phone').eq('clinic_id', CLINIC_ID).eq('memo', m);
  console.log(`customers memo="${m}": ${c?.length||0}건`, (c||[]).slice(0,3).map(x=>x.name));
}

// 3) 6/13 비더미(실데이터) 4건 상세 — 보존 대상 확인
const { data: resv } = await sb.from('reservations')
  .select('id, customer_id, customer_name, reservation_time, visit_type, memo, status, created_at')
  .eq('clinic_id', CLINIC_ID).eq('reservation_date', DATE).order('reservation_time');
const real = (resv||[]).filter(r => !MARKERS.includes(r.memo));
console.log(`\n=== 6/13 비더미(보존대상) ${real.length}건 ===`);
real.forEach(r => console.log(`  ${r.reservation_time?.slice(0,5)} ${r.visit_type} ${r.customer_name} cid=${r.customer_id?'SET':'NULL'} memo="${r.memo}" created=${(r.created_at||'').slice(0,16)}`));

// 4) 삭제 대상 더미 = 정확히 52건인지
const dummy = (resv||[]).filter(r => MARKERS.includes(r.memo));
console.log(`\n삭제 대상 더미: ${dummy.length}건 (52 기대)`);
console.log('  cid NULL:', dummy.filter(r=>!r.customer_id).length, '/ cid SET:', dummy.filter(r=>r.customer_id).length);

console.log('\n=== PRECHECK DONE ===');
