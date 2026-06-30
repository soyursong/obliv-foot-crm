/** AC-1 격리 2차 — read-only. 동행 패턴 실측. */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  .split('\n').filter((l) => l && !l.startsWith('#') && l.includes('='))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// 총 dopamine 예약 수
const tot = await sb.from('reservations').select('id', { count: 'exact', head: true }).eq('source_system', 'dopamine');
console.log('dopamine 예약 총수:', tot.count ?? `에러 ${tot.error?.message}`);

// +821000000000 더미폰 customer가 묶인 예약들
const dummy = await sb.from('customers').select('id, name, created_at').eq('phone', '+821000000000').limit(5);
console.log('\n더미폰 customer:', JSON.stringify(dummy.data ?? dummy.error, null, 1));
if (dummy.data?.[0]) {
  const rs = await sb.from('reservations')
    .select('id, customer_name, reservation_date, source_system, external_id, status, created_at')
    .eq('customer_id', dummy.data[0].id).order('created_at', { ascending: false }).limit(10);
  console.log('더미폰 customer 연결 예약:', rs.error ? rs.error.message : `${rs.data.length}건`);
  if (rs.data) console.table(rs.data.map((r) => ({ name: r.customer_name, date: r.reservation_date, src: r.source_system, ext: (r.external_id ?? '').slice(0, 30), st: r.status })));
}

// 오늘(2026-06-30) 생성 예약 전수 — 동행 시도 흔적
const today = await sb.from('reservations')
  .select('id, customer_name, customer_phone, customer_id, source_system, external_id, status, created_at')
  .gte('created_at', '2026-06-29T00:00:00Z').order('created_at', { ascending: false }).limit(30);
console.log('\n최근 생성 예약(6/29~):', today.error ? today.error.message : `${today.data.length}건`);
if (today.data) console.table(today.data.map((r) => ({
  name: r.customer_name ?? 'NULL', phone: (r.customer_phone ?? 'NULL'), cust: r.customer_id ? 'set' : 'NULL',
  src: r.source_system ?? '-', ext: (r.external_id ?? '').slice(0, 24), st: r.status })));

// external_id에 동행 composite 접미사(#, companion, -c) 패턴 존재 여부
const comp = await sb.from('reservations').select('id, external_id, customer_name')
  .or('external_id.ilike.%#%,external_id.ilike.%companion%,external_id.ilike.%-c%').limit(10);
console.log('\ncomposite external_id(동행) 패턴 예약:', comp.error ? comp.error.message : `${comp.data.length}건`);
if (comp.data) console.table(comp.data);
