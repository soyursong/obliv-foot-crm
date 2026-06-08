/**
 * P1 diag — 오늘(2026-06-08) 더미 76건 차트 미열림 진단
 * READ-ONLY. customer_id NULL 여부 + 동명이인 fallback 발동 여부 확인
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const DATE = '2026-06-08';

console.log('=== Step 1: 오늘 더미 예약 전수 ===');
const { data: rs, error: er1 } = await sb
  .from('reservations')
  .select('id, customer_id, customer_name, visit_type, reservation_date, reservation_time, memo, customer_phone, clinic_id')
  .eq('reservation_date', DATE)
  .eq('memo', '테스트 더미')
  .order('reservation_time', { ascending: true });

if (er1) {
  console.error('rs err', er1);
  // try alt column name "scheduled_time"
  const { data: rs2, error: er2 } = await sb
    .from('reservations')
    .select('*')
    .eq('memo', '테스트 더미')
    .limit(5);
  console.log('alt schema sample', rs2?.[0], 'err', er2);
  process.exit(1);
}

console.log(`총 ${rs.length}건`);
const nullCnt = rs.filter(r => !r.customer_id).length;
const hasCnt = rs.filter(r => r.customer_id).length;
console.log(`customer_id NULL: ${nullCnt}, 있음: ${hasCnt}`);

console.log('\n--- 샘플 10건 ---');
rs.slice(0, 10).forEach(r => {
  console.log(`${r.reservation_time?.slice(0,5)} | ${r.visit_type?.padEnd(10)} | cid=${r.customer_id ? r.customer_id.slice(0,8) : 'NULL'} | ${r.customer_name?.padEnd(8)} | ${r.customer_phone}`);
});

console.log('\n=== Step 2: 동명이인 guard 발동 시뮬레이션 ===');
// 각 예약의 customer_name 에 대해 customers 테이블에서 동일 clinic_id+name 카운트
const clinicId = rs[0]?.clinic_id;
console.log('clinic_id:', clinicId);

const names = [...new Set(rs.map(r => r.customer_name).filter(Boolean))];
console.log(`고유 이름 ${names.length}개`);

const dup = [], single = [], none = [];
for (const name of names) {
  const { data: matches } = await sb
    .from('customers')
    .select('id, name, phone, visit_type, is_simulation, memo')
    .eq('clinic_id', clinicId)
    .eq('name', name);
  if (!matches || matches.length === 0) none.push({ name, count: 0 });
  else if (matches.length === 1) single.push({ name, count: 1, cid: matches[0].id.slice(0,8), phone: matches[0].phone });
  else dup.push({ name, count: matches.length, samples: matches.slice(0,4).map(m => ({ cid: m.id.slice(0,8), phone: m.phone, sim: m.is_simulation })) });
}

console.log(`\nname 매칭 결과 (${names.length}개 중):`);
console.log(`  - customers 없음(0): ${none.length}개 → 차트 안 열림 (토스트 "고객 미연결")`);
console.log(`  - 단일 매칭(1): ${single.length}개 → 차트 열림 + 백그라운드 링크백`);
console.log(`  - 동명이인(>=2): ${dup.length}개 → 토스트 "동명이인 X명" guard 발동`);

if (dup.length) {
  console.log('\n--- 동명이인 guard 발동 이름 샘플 ---');
  dup.slice(0, 8).forEach(d => {
    console.log(`  ${d.name} (${d.count}건): ${JSON.stringify(d.samples)}`);
  });
}
if (none.length) {
  console.log('\n--- customers 없음 이름 샘플 ---');
  console.log(none.slice(0, 8).map(n => n.name).join(', '));
}
if (single.length) {
  console.log('\n--- 단일 매칭 이름 샘플 ---');
  console.log(single.slice(0, 8).map(s => `${s.name}(${s.cid})`).join(', '));
}

console.log('\n=== Step 3: 더미 예약 phone 의 고객 매칭 ===');
const dummyPhones = [...new Set(rs.map(r => r.customer_phone).filter(Boolean))];
console.log(`고유 phone ${dummyPhones.length}개. 샘플:`, dummyPhones.slice(0, 5));
const { data: phMatches } = await sb
  .from('customers')
  .select('id, phone, name')
  .in('phone', dummyPhones.slice(0, 100));
console.log(`phone으로 매칭되는 customers: ${phMatches?.length ?? 0}건`);
if (phMatches?.length) console.log('샘플:', phMatches.slice(0,5));
