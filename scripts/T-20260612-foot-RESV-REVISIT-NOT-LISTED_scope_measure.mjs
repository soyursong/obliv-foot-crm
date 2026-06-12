// GO_WARN scope 실측: A2 sim filter 전면완화(no-op) 시 admin에 재유입되는 sim 고객/예약 규모.
// 목적 = (a) 전면완화 부작용 측정 vs (b) 화이트리스트 필요 여부 판정.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter(Boolean).map((l) => {
      const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)];
    }),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const out = (label, v) => console.log(`\n=== ${label} ===\n` + (typeof v === 'string' ? v : JSON.stringify(v, null, 2)));

// 1) sim 고객 전체 분포 (지점별)
const { data: simCusts, error: e1 } = await sb
  .from('customers')
  .select('id, name, clinic_id, is_simulation')
  .eq('is_simulation', true);
if (e1) throw e1;
out('sim 고객 총수', simCusts.length);
const byClinic = {};
for (const c of simCusts) byClinic[c.clinic_id] = (byClinic[c.clinic_id] || 0) + 1;
out('sim 고객 지점별 분포', byClinic);
out('sim 고객 이름 목록(최대 50)', simCusts.slice(0, 50).map((c) => `${c.name} [${c.clinic_id?.slice(0, 8)}]`));

// 2) sim 고객이 가진 예약 — 비취소. 청크(.in URL 한계 회피)
const simIds = simCusts.map((c) => c.id);
const simIdSet = new Set(simIds);
const chunk = (arr, n) => arr.reduce((a, _, i) => (i % n ? a : [...a, arr.slice(i, i + n)]), []);
let resvAll = [];
for (const ids of chunk(simIds, 100)) {
  const { data, error } = await sb
    .from('reservations')
    .select('id, reservation_date, status, visit_type, customer_id, clinic_id')
    .in('customer_id', ids)
    .neq('status', 'cancelled');
  if (error) throw error;
  resvAll = resvAll.concat(data);
}
out('sim 고객 비취소 예약 총수(전 기간)', resvAll.length);

const today = new Date('2026-06-13');
const lo = new Date(today); lo.setDate(lo.getDate() - 1);
const hi = new Date(today); hi.setDate(hi.getDate() + 14);
const fmt = (d) => d.toISOString().slice(0, 10);
const win = resvAll.filter((r) => r.reservation_date >= fmt(lo) && r.reservation_date <= fmt(hi));
out(`sim 예약 admin 노출창(${fmt(lo)}~${fmt(hi)}) 재유입 건수`, win.length);
const winByClinic = {};
for (const r of win) winByClinic[r.clinic_id] = (winByClinic[r.clinic_id] || 0) + 1;
out('재유입 예약 지점별', winByClinic);
out('재유입 예약 상세(최대 40)', win.slice(0, 40).map((r) => `${r.reservation_date} ${r.status} ${r.visit_type} cust=${r.customer_id?.slice(0,8)} clinic=${r.clinic_id?.slice(0,8)}`));

// 3) 토마토 확인
const tomato = simCusts.find((c) => c.name && c.name.includes('토마토'));
out('토마토 존재 여부', tomato ? `있음 id=${tomato.id} clinic=${tomato.clinic_id}` : '없음');

process.exit(0);
