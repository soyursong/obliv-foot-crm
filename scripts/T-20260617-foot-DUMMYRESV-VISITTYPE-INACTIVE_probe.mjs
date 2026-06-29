/**
 * T-20260617-foot-DUMMYRESV-VISITTYPE-INACTIVE — READ-ONLY PROBE (no writes)
 * 더미 생성 예약이 비활성 박스(Box 1)에 표시되는 원인 실측.
 * 종로점(jongno-foot, clinic 74967aea) 2026-06-17.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const DATE = '2026-06-17';

// 모든 컬럼을 가져와 스키마 + 값 분포 파악 (is_simulation 등 존재 여부 포함)
const { data: all, error } = await sb
  .from('reservations')
  .select('*')
  .eq('clinic_id', CLINIC_ID)
  .eq('reservation_date', DATE)
  .order('reservation_time', { ascending: true });

if (error) { console.error('QUERY FAIL:', error); process.exit(1); }

console.log(`\n=== 2026-06-17 종로점 전체 예약: ${all.length}건 ===`);
if (all.length) {
  console.log('컬럼:', Object.keys(all[0]).join(', '));
}

const isDummy = (r) =>
  (r.memo && (/DUMMY|TEST/i.test(r.memo))) ||
  (r.created_by && /^TEST-/i.test(r.created_by));

console.log('\n=== 전체 행 요약 ===');
for (const r of all) {
  console.log(
    `${(r.reservation_time||'').slice(0,5)} | name=${(r.customer_name||'').padEnd(5)} | visit_type=${String(r.visit_type).padEnd(10)} | status=${String(r.status).padEnd(12)} | is_sim=${r.is_simulation} | created_by=${r.created_by} | dummy=${isDummy(r)} | checked_in_at=${r.checked_in_at ?? '-'} | memo=${r.memo ?? '-'}`
  );
}

const dummy = all.filter(isDummy);
const real = all.filter(r => !isDummy(r));

const dist = (rows, key) => {
  const m = {};
  rows.forEach(r => { const v = String(r[key]); m[v] = (m[v]||0)+1; });
  return m;
};

console.log('\n=== 더미 분포 ===', `(${dummy.length}건)`);
console.log('  visit_type:', JSON.stringify(dist(dummy, 'visit_type')));
console.log('  status    :', JSON.stringify(dist(dummy, 'status')));
console.log('  is_sim    :', JSON.stringify(dist(dummy, 'is_simulation')));

console.log('\n=== 원내직접(real) 분포 ===', `(${real.length}건)`);
console.log('  visit_type:', JSON.stringify(dist(real, 'visit_type')));
console.log('  status    :', JSON.stringify(dist(real, 'status')));
console.log('  is_sim    :', JSON.stringify(dist(real, 'is_simulation')));

// 14:30 재진 비교 (정상 활성으로 보이는 원내건 vs 더미건)
console.log('\n=== 14:30 행 비교 ===');
all.filter(r => (r.reservation_time||'').startsWith('14:30')).forEach(r => {
  console.log(`  ${isDummy(r)?'[더미]':'[원내]'} name=${r.customer_name} visit_type=${r.visit_type} status=${r.status} is_sim=${r.is_simulation} checked_in_at=${r.checked_in_at??'-'}`);
});
