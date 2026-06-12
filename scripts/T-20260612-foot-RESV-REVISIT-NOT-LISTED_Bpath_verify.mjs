// (b) 화이트리스트 정책 검증 — live dev DB로 stripSimulationRows 신정책 재현.
// 기대: 토마토(화이트리스트 sim)=노출 / 양배추·고양이(비화이트리스트 sim)=숨김 / 실고객=불변.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter(Boolean).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const EXPOSED_SIM_NAMES = new Set(['토마토']);

// simulationFilter.ts 신정책 재현
async function stripSimulationRows(rows) {
  if (rows.length === 0) return rows;
  const ids = [...new Set(rows.map((r) => r.customer_id).filter(Boolean))];
  if (ids.length === 0) return rows;
  const { data, error } = await sb.from('customers').select('id, name').in('id', ids).eq('is_simulation', true);
  if (error || !data || data.length === 0) return rows;
  const hidden = new Set(data.filter((c) => !EXPOSED_SIM_NAMES.has((c.name ?? '').trim())).map((c) => c.id));
  if (hidden.size === 0) return rows;
  return rows.filter((r) => !r.customer_id || !hidden.has(r.customer_id));
}

const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const { data: rows } = await sb.from('reservations')
  .select('id, customer_id, reservation_date, visit_type, status')
  .eq('clinic_id', CLINIC).gte('reservation_date', '2026-06-12').lte('reservation_date', '2026-06-27')
  .neq('status', 'cancelled');

const before = rows.length;
const after = await stripSimulationRows(rows);
const afterIds = new Set(after.map((r) => r.customer_id));

const names = new Map((await sb.from('customers').select('id,name').in('id', [...new Set(rows.map((r) => r.customer_id).filter(Boolean))])).data.map((c) => [c.id, c.name]));
const isVisible = (custId) => afterIds.has(custId);

const tomato = '45adae8f-5f96-412b-80e4-49c10a27463f';
const yangbaechu = '69a74e49-ac6f-434e-94ed-709a455642b1';
const goyangi = '6cfc1a3d-a19d-4687-9bd6-2372ec6beef7';

const assert = (cond, label) => console.log(`${cond ? '✅ PASS' : '❌ FAIL'} — ${label}`);
console.log(`노출창 예약 ${before}건 → 필터 후 ${after.length}건 (제거 ${before - after.length}건)\n`);
assert(isVisible(tomato), '토마토(화이트리스트 sim) admin 노출');
assert(!isVisible(yangbaechu), '양배추(비화이트리스트 sim) admin 숨김 유지');
assert(!isVisible(goyangi), '고양이(비화이트리스트 sim) admin 숨김 유지');

// 실고객(비-sim) 무손상: before의 비-sim 고객은 100% after에 존재
const { data: simSet } = await sb.from('customers').select('id').eq('is_simulation', true)
  .in('id', [...new Set(rows.map((r) => r.customer_id).filter(Boolean))]);
const simIds = new Set(simSet.map((c) => c.id));
const realRowsBefore = rows.filter((r) => !r.customer_id || !simIds.has(r.customer_id));
const realRowsAfter = after.filter((r) => !r.customer_id || !simIds.has(r.customer_id));
assert(realRowsBefore.length === realRowsAfter.length, `실고객/워크인 예약 무손상 (${realRowsBefore.length}건 → ${realRowsAfter.length}건, 누락 0)`);

// 제거된 행 이름 확인
const removed = rows.filter((r) => !afterIds.has(r.customer_id)).map((r) => names.get(r.customer_id));
console.log('\n숨겨진 행 고객명:', JSON.stringify(removed));
process.exit(0);
