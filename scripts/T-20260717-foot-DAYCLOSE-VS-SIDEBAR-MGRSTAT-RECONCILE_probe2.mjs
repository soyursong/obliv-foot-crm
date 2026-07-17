/**
 * T-20260717-foot-DAYCLOSE-VS-SIDEBAR-MGRSTAT-RECONCILE — READ-ONLY RCA probe #2
 * 실제 티켓 페어 대조:
 *   View A = 일마감 > 담당자별 매출 (Closing.tsx staffTotals)
 *            per-day, created_at KST, customers.assigned_staff_id, 전체 tax_type, payments+pkg+manual
 *   View B = 사이드바 통계 > 실장별 실적 (ConsultantSection, foot_stats_consultant RPC)
 *            checked_in_at KST range, check_ins.consultant_id, role='consultant'+티켓팅, manual 제외
 * SELECT/RPC-only. 어떤 write/DDL도 없음.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CID = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // jongno-foot
console.log('clinic: jongno-foot', CID);

const { data: staff } = await sb.from('staff').select('id, name, role, active').eq('clinic_id', CID);
const staffName = new Map(staff.map(s => [s.id, s.name]));
const staffRole = new Map(staff.map(s => [s.id, s.role]));

// ---------- View A: 일마감 담당자별 (per-day, created_at, assigned_staff_id, ALL tax, +manual) ----------
async function viewA(day) {
  const start = `${day}T00:00:00+09:00`, end = `${day}T23:59:59+09:00`;
  const { data: pays } = await sb.from('payments')
    .select('amount, payment_type, tax_type, customer_id').eq('clinic_id', CID)
    .neq('status', 'deleted').gte('created_at', start).lte('created_at', end);
  const { data: pkgs } = await sb.from('package_payments')
    .select('amount, payment_type, customer_id').eq('clinic_id', CID)
    .gte('created_at', start).lte('created_at', end);
  const { data: manuals } = await sb.from('closing_manual_payments')
    .select('amount, staff_name').eq('clinic_id', CID)
    .gte('close_date', day).lte('close_date', day);
  const cids = [...new Set([...pays, ...pkgs].map(p => p.customer_id).filter(Boolean))];
  const cs = new Map();
  for (let i = 0; i < cids.length; i += 500) {
    const { data } = await sb.from('customers').select('id, assigned_staff_id, is_simulation').in('id', cids.slice(i, i + 500));
    for (const c of data) cs.set(c.id, c);
  }
  const nameToId = new Map(staff.filter(s => s.name).map(s => [s.name, s.id]));
  const v = new Map();
  const add = (key, amt, sim) => {
    const e = v.get(key) ?? { total: 0, sim: 0 };
    e.total += amt; if (sim) e.sim += amt; v.set(key, e);
  };
  for (const p of [...pays, ...pkgs]) {
    const c = p.customer_id ? cs.get(p.customer_id) : null;
    const key = c?.assigned_staff_id ? (staffName.get(c.assigned_staff_id) ?? '미지정') : '미지정';
    add(key, p.payment_type === 'refund' ? -p.amount : p.amount, c?.is_simulation);
  }
  for (const m of manuals) add(m.staff_name ?? '미지정', m.amount ?? 0, false);
  return v;
}

// ---------- View B: 통계 실장별 실적 (foot_stats_consultant RPC) ----------
async function viewB(from, to) {
  const { data, error } = await sb.rpc('foot_stats_consultant', { p_clinic_id: CID, p_from: from, p_to: to });
  if (error) throw error;
  return data;
}

const DAY = process.argv[2] || '2026-07-16';
const MONTH_FROM = '2026-07-01', MONTH_TO = '2026-07-17';

console.log(`\n══════ View A — 일마감 담당자별 매출 [${DAY}] (created_at, assigned_staff, 전체tax+manual) ══════`);
const a = await viewA(DAY);
let aTot = 0;
for (const [name, e] of [...a.entries()].sort((x, y) => y[1].total - x[1].total)) {
  aTot += e.total;
  console.log(`  ${name.padEnd(8)} | total ${e.total.toLocaleString().padStart(12)}${e.sim ? `  (sim포함 ${e.sim.toLocaleString()})` : ''}`);
}
console.log(`  ─ 합계 ${aTot.toLocaleString()}`);

console.log(`\n══════ View B — 통계 실장별 실적 [${DAY}~${DAY}] (checked_in_at, consultant_id, 티켓팅건만) ══════`);
const bDay = await viewB(DAY, DAY);
let bDayTot = 0;
for (const r of bDay) { bDayTot += Number(r.total_amount); console.log(`  ${(r.name ?? '미지정').padEnd(8)} | 총매출 ${Number(r.total_amount).toLocaleString().padStart(12)} | 티켓팅 ${r.ticketing_count} | 객단가 ${Number(r.avg_amount).toLocaleString()}`); }
console.log(`  ─ 합계 ${bDayTot.toLocaleString()}  (rows=${bDay.length})`);

console.log(`\n══════ View B(월간 기본값) — 통계 실장별 실적 [${MONTH_FROM}~${MONTH_TO}] ══════  ← 사이드바 진입 시 실제 표시 기간(preset='month')`);
const bMon = await viewB(MONTH_FROM, MONTH_TO);
let bMonTot = 0;
for (const r of bMon) { bMonTot += Number(r.total_amount); console.log(`  ${(r.name ?? '미지정').padEnd(8)} | 총매출 ${Number(r.total_amount).toLocaleString().padStart(12)} | 티켓팅 ${r.ticketing_count}`); }
console.log(`  ─ 합계 ${bMonTot.toLocaleString()}  (rows=${bMon.length})`);

// staff role reference (누가 consultant 인가)
console.log('\n── staff role 참조 (View B는 role=consultant 만 집계) ──');
for (const s of staff.filter(s => s.active !== false).sort((a,b)=>(a.role||'').localeCompare(b.role||'')))
  console.log(`  ${(s.name||'').padEnd(8)} | role=${s.role}`);

console.log('\nDONE (read-only)');
