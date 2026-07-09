/**
 * T-20260709-foot-COMPANION-RESV-FIELD-DROP — RC read-only 진단 (비파괴 SELECT only)
 * 목적: 동행 예약 row(is_companion, customer_id=NULL) 의 예약경로/등록자/메모/성함 컬럼이
 *   값 있음(→detail 폼 매핑 gap) vs NULL(→ingest drop) 인지 판별.
 * prod rxlomoozakkjesdqjtvd. SELECT/RPC read only.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });
console.log('=== prod', url, '===\n');

// 1) 동행 예약 최근 목록: is_companion=true 또는 customer_id IS NULL + source_system=dopamine
const cols = 'id, created_at, reservation_date, customer_id, customer_name, customer_real_name, customer_phone, source_system, external_id, visit_route, registrar_id, registrar_name, brief_note, memo, is_companion, status';
let { data: comp, error: e1 } = await sb
  .from('reservations')
  .select(cols)
  .eq('is_companion', true)
  .order('created_at', { ascending: false })
  .limit(15);
if (e1) {
  console.log('[is_companion 컬럼 조회 실패]', e1.message);
  // 폴백: is_companion 컬럼이 없을 수 있음 → customer_id IS NULL 로 재조회
  const r2 = await sb.from('reservations').select(cols.replace(', is_companion', ''))
    .is('customer_id', null).eq('source_system', 'dopamine')
    .order('created_at', { ascending: false }).limit(15);
  comp = r2.data; e1 = r2.error;
  if (e1) console.log('[폴백 조회도 실패]', e1.message);
}
console.log('[1] 동행/무고객 예약 (최근 15):', comp ? comp.length + '건' : '0');
for (const r of comp ?? []) {
  console.log(JSON.stringify({
    id: r.id?.slice(0, 8), date: r.reservation_date, src: r.source_system, ext: r.external_id,
    name: r.customer_name, real_name: r.customer_real_name, phone: r.customer_phone,
    visit_route: r.visit_route, reg_id: r.registrar_id ? 'Y' : null, reg_name: r.registrar_name,
    brief: r.brief_note, memo: r.memo, is_comp: r.is_companion, status: r.status,
  }));
}

// 2) 각 동행 row 의 예약메모 timeline (reservation_memo_history) 존재 여부
console.log('\n[2] 예약메모 timeline(reservation_memo_history) 착지 여부:');
for (const r of (comp ?? []).slice(0, 8)) {
  const { data: rmh } = await sb.from('reservation_memo_history')
    .select('content, created_by_name, source_system').eq('reservation_id', r.id).limit(5);
  console.log(`  ${r.id?.slice(0,8)} (${r.customer_name}): ${rmh?.length ?? 0} memo →`,
    (rmh ?? []).map((m) => `[${m.source_system}]${m.created_by_name}:${(m.content||'').slice(0,20)}`).join(' | '));
}

// 3) 컬럼 존재/타입 확인 (reservations 에 visit_route/memo/is_companion 실재?)
console.log('\n[3] reservations 컬럼 실재 확인 (샘플 1행 keys):');
const { data: one } = await sb.from('reservations').select('*').limit(1);
if (one?.[0]) {
  const keys = Object.keys(one[0]);
  for (const c of ['visit_route','registrar_name','registrar_id','memo','brief_note','is_companion','source_system','customer_real_name','customer_name'])
    console.log(`  ${c}: ${keys.includes(c) ? 'EXISTS' : '❌ MISSING'}`);
}
console.log('\n=== RC done ===');
