/**
 * T-20260715-foot-CLOSING-SINGLEPAY-F4716-CHARTMATCH-RECUR — READ-ONLY PROBE
 *
 * Part1 apply 전 freeze셋 2건의 prod 실제 상태를 재구성한다(dry-run 근거 스냅샷).
 * 어떤 write 도 하지 않는다.
 *   freeze셋: F-4716 김희정 pkg 3f4d3ec6 (내성체험권/RC-B) · F-4666 김지민 pkg 5ed60da7 (무좀체험권/RC-C)
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const won = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR'));
const PKG_PREFIX = ['3f4d3ec6', '5ed60da7'];

// 1) 대상 패키지(id prefix) 확정
const { data: allPkgsRaw, error: e1 } = await sb.from('packages').select('*');
if (e1) throw new Error('packages: ' + e1.message);
const targetPkgs = allPkgsRaw.filter((p) => PKG_PREFIX.some((pre) => (p.id ?? '').startsWith(pre)));
console.log('═══ 1. FREEZE-SET 활성 패키지 ═══');
for (const p of targetPkgs) {
  console.log(`\n  pkg ${p.id}`);
  console.log(`    name=${p.package_name ?? p.name} status=${p.status} total_sessions=${p.total_sessions}`);
  console.log(`    total_amount=${won(p.total_amount)} paid_amount=${won(p.paid_amount)} consultation_fee=${won(p.consultation_fee)}`);
  console.log(`    customer_id=${p.customer_id} clinic_id=${p.clinic_id} created_at=${p.created_at}`);
}

// 2) 대상 고객의 전체 패키지(취소·재생성 포함) — 고아 credit 추적
const custIds = [...new Set(targetPkgs.map((p) => p.customer_id))];
const { data: custs } = await sb.from('customers').select('id, name, phone, chart_number').in('id', custIds);
console.log('\n═══ 2. 고객 & 전체 패키지(취소/재생성 이력) ═══');
for (const c of custs ?? []) {
  console.log(`\n  고객 ${c.name} (chart=${c.chart_number ?? '-'} phone=${c.phone ?? '-'}) id=${c.id}`);
  const cpkgs = allPkgsRaw.filter((p) => p.customer_id === c.id).sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
  for (const p of cpkgs) {
    console.log(`    [${p.status}] ${p.id.slice(0, 8)} ${p.package_name ?? p.name} total=${won(p.total_amount)} paid=${won(p.paid_amount)} sess=${p.total_sessions} created=${p.created_at}`);
  }
}

// 3) package_payments — 대상 패키지 + 대상 고객 전체 패키지
const custPkgIds = allPkgsRaw.filter((p) => custIds.includes(p.customer_id)).map((p) => p.id);
const { data: pps } = await sb.from('package_payments').select('*').in('package_id', custPkgIds);
console.log('\n═══ 3. package_payments (대상 고객 전체 패키지) ═══');
if (!pps || pps.length === 0) console.log('  (없음)');
for (const pp of pps ?? []) {
  console.log(`  pkg ${pp.package_id.slice(0, 8)} amt=${won(pp.amount)} type=${pp.payment_type} fee_kind=${pp.fee_kind} method=${pp.method} created=${pp.created_at} memo=${pp.memo}`);
}

// 4) payments — 대상 고객 (07-15 및 전체 최근)
const { data: pays } = await sb.from('payments').select('*').in('customer_id', custIds).order('created_at', { ascending: true });
console.log('\n═══ 4. payments (대상 고객) ═══');
for (const p of pays ?? []) {
  console.log(`  ${p.created_at} amt=${won(p.amount)} type=${p.payment_type} method=${p.method} check_in_id=${p.check_in_id ? p.check_in_id.slice(0,8) : 'NULL'} memo=${p.memo}`);
}

// 5) 잔금(due) 산출 — loadCustomerOutstanding 로직 재현 (active pkg만, package_payments 기준)
console.log('\n═══ 5. DUE 재현 (loadCustomerOutstanding: active pkg, package_payments net) ═══');
for (const c of custs ?? []) {
  const activePkgs = allPkgsRaw.filter((p) => p.customer_id === c.id && p.status === 'active');
  let pkgDue = 0;
  for (const p of activePkgs) {
    const rows = (pps ?? []).filter((x) => x.package_id === p.id && x.fee_kind === 'package');
    const net = rows.reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
    const due = Math.max(0, (p.total_amount ?? 0) - net);
    console.log(`  ${c.name} active pkg ${p.id.slice(0,8)} total=${won(p.total_amount)} pp_net=${won(net)} DUE=${won(due)}`);
    pkgDue += due;
  }
  console.log(`  → ${c.name} 총 packageDue = ${won(pkgDue)}`);
}

// 6) 07-15 당일 결제 전수 (net-zero 검증 baseline)
const { data: dayPays } = await sb.from('payments').select('customer_id, amount, payment_type, memo, created_at')
  .gte('created_at', '2026-07-15').lt('created_at', '2026-07-16');
console.log('\n═══ 6. 07-15 payments 전수 (net-zero baseline) ═══');
const dayNet = (dayPays ?? []).reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
console.log(`  건수=${(dayPays ?? []).length} net합=${won(dayNet)}`);

console.log('\n⚠ READ-ONLY — write 없음.');
