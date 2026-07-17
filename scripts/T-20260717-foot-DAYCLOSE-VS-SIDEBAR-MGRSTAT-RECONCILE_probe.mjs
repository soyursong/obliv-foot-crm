/**
 * T-20260717-foot-DAYCLOSE-VS-SIDEBAR-MGRSTAT-RECONCILE — READ-ONLY RCA probe
 * 두 뷰(매출집계>담당실장별 vs 일마감>담당자별)의 수치 델타 재현.
 * SELECT-only. 어떤 write/DDL도 없음.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const url = env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });

const CID = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // jongno-foot
console.log('clinic: jongno-foot', CID);

// staff id->name
const { data: staff, error: sErr } = await sb.from('staff').select('id, name').eq('clinic_id', CID);
if (sErr) throw sErr;
const staffName = new Map(staff.map(s => [s.id, s.name]));

// ---- 화면① SalesDoctorTab: week 2026-07-13~07-19, accounting_date, 비급여 순매출 ----
const FROM = '2026-07-13', TO = '2026-07-19';
const { data: pays1 } = await sb.from('payments')
  .select('amount, payment_type, tax_type, accounting_date, customer_id')
  .eq('clinic_id', CID).neq('status', 'deleted')
  .gte('accounting_date', FROM).lte('accounting_date', TO);

// customers assigned_staff
const custIds1 = [...new Set(pays1.map(p => p.customer_id).filter(Boolean))];
const custStaff = new Map();
for (let i = 0; i < custIds1.length; i += 500) {
  const { data } = await sb.from('customers').select('id, assigned_staff_id, is_simulation').in('id', custIds1.slice(i, i + 500));
  for (const c of data) custStaff.set(c.id, c);
}
const view1 = new Map(); // staffId -> {nonIns, copay, presale, count}
for (const p of pays1) {
  const c = p.customer_id ? custStaff.get(p.customer_id) : null;
  if (c?.is_simulation) continue; // ① excludes simulation
  const sid = c?.assigned_staff_id ?? '미지정';
  const net = p.payment_type === 'refund' ? -p.amount : p.amount;
  const e = view1.get(sid) ?? { nonIns: 0, copay: 0, presale: 0, count: 0 };
  e.count++;
  if (p.tax_type === '급여') e.copay += net;
  else if (p.tax_type === '선수금') e.presale += net;
  else e.nonIns += net;
  view1.set(sid, e);
}
console.log('\n=== 화면① 매출집계>담당실장별 (week 07-13~07-19, accounting_date, 비급여순매출) ===');
for (const [sid, e] of [...view1.entries()].sort((a,b)=>b[1].nonIns-a[1].nonIns))
  console.log(`  ${(staffName.get(sid) ?? '미지정').padEnd(6)} | 건수 ${String(e.count).padStart(3)} | 비급여순매출 ${e.nonIns.toLocaleString().padStart(12)} | 급여본부금 ${e.copay.toLocaleString().padStart(10)} | 선수금 ${e.presale.toLocaleString().padStart(10)}`);

// ---- 화면② Closing staffTotals: single day, created_at KST, ALL tax_type, +packages+manual ----
async function closingDay(day) {
  const start = `${day}T00:00:00+09:00`, end = `${day}T23:59:59+09:00`;
  const { data: pays } = await sb.from('payments')
    .select('amount, method, payment_type, customer_id').eq('clinic_id', CID)
    .neq('status', 'deleted').gte('created_at', start).lte('created_at', end);
  const { data: pkgs } = await sb.from('package_payments')
    .select('amount, method, payment_type, customer_id').eq('clinic_id', CID)
    .gte('created_at', start).lte('created_at', end);
  const { data: manuals } = await sb.from('closing_manual_payments')
    .select('amount, method, staff_name').eq('clinic_id', CID)
    .gte('close_date', day).lte('close_date', day);
  const cids = [...new Set([...pays, ...pkgs].map(p => p.customer_id).filter(Boolean))];
  const cs = new Map();
  for (let i = 0; i < cids.length; i += 500) {
    const { data } = await sb.from('customers').select('id, assigned_staff_id').in('id', cids.slice(i, i + 500));
    for (const c of data) cs.set(c.id, c.assigned_staff_id);
  }
  const v = new Map();
  const add = (name, method, amt) => {
    const e = v.get(name) ?? { total:0, card:0, cash:0, transfer:0 };
    e.total += amt;
    if (method === 'card' || method === 'membership') e.card += amt;
    else if (method === 'cash') e.cash += amt;
    else if (method === 'transfer') e.transfer += amt;
    v.set(name, e);
  };
  for (const p of [...pays, ...pkgs]) {
    const sid = p.customer_id ? cs.get(p.customer_id) : null;
    const name = sid ? (staffName.get(sid) ?? '미지정') : '미지정';
    add(name, p.method, p.payment_type === 'refund' ? -p.amount : p.amount);
  }
  for (const m of manuals) add(m.staff_name ?? '미지정', m.method, m.amount ?? 0);
  return v;
}

// scan recent days to find the one matching screenshot② (송지현 ~7.8M)
console.log('\n=== 화면② 일마감>담당자별 (per-day, created_at, 전체결제, +pkg+manual) ===');
for (const day of ['2026-07-17','2026-07-16','2026-07-15','2026-07-14','2026-07-13']) {
  const v = await closingDay(day);
  const tot = [...v.values()].reduce((s,e)=>s+e.total,0);
  console.log(`\n  [${day}] 합계 ${tot.toLocaleString()}`);
  for (const [name, e] of [...v.entries()].sort((a,b)=>b[1].total-a[1].total))
    console.log(`     ${name.padEnd(6)} | total ${e.total.toLocaleString().padStart(11)} | 카드 ${e.card.toLocaleString().padStart(11)} | 현금 ${e.cash.toLocaleString().padStart(9)} | 이체 ${e.transfer.toLocaleString().padStart(11)}`);
}
console.log('\nDONE (read-only)');
