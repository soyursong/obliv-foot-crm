// T-20260723-foot-CONSULTANT-TKTREV-DAYCLOSE-RECONCILE — READ-ONLY prod probe.
// 목적: '상담실장 티켓팅 실적'(foot_stats_consultant total_amount) vs 일마감 결제내역(payments 수납 grain)
//       두 뷰의 델타를 축(WHEN/WHO/SCOPE)별로 분해. SELECT-only, 데이터 변경 0.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=')).map(l => {
      const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const net = (rows) => rows.reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);

async function main() {
  // 1) foot clinic
  const { data: clinics } = await sb.from('clinics').select('id, name, slug');
  const clinic = clinics?.find(c => /foot|풋/i.test(`${c.slug} ${c.name}`)) ?? clinics?.[0];
  console.log('clinic:', clinic?.id, clinic?.name, clinic?.slug, `(total ${clinics?.length})`);
  const cid = clinic.id;

  // 기간: 당월(preset=month 기본값 재현). 필요시 인자로 교체.
  const from = process.argv[2] ?? '2026-07-01';
  const to = process.argv[3] ?? '2026-07-23';
  console.log('period:', from, '~', to, '\n');

  // 2) View B: foot_stats_consultant RPC (상담실장 티켓팅 실적 소스)
  const { data: rpc, error: rpcErr } = await sb.rpc('foot_stats_consultant', {
    p_clinic_id: cid, p_from: from, p_to: to,
  });
  if (rpcErr) console.log('RPC error:', rpcErr.message);
  const rpcTotal = (rpc ?? []).reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
  console.log('=== View B: 상담실장 티켓팅 실적 (foot_stats_consultant) ===');
  console.log('  Σ total_amount =', rpcTotal.toLocaleString(), `(rows: ${(rpc ?? []).length})`);
  (rpc ?? []).forEach(r => console.log(`    ${r.name}: tkt=${r.ticketing_count} total=${Number(r.total_amount).toLocaleString()}`));

  // 3) View A: 일마감 결제내역 = payments + package_payments + closing_manual (created_at, net, ALL)
  const dayStart = `${from}T00:00:00+09:00`;
  const dayEnd = `${to}T23:59:59.999+09:00`;
  const { data: pays } = await sb.from('payments')
    .select('amount, payment_type, created_at, accounting_date, check_in_id')
    .eq('clinic_id', cid).gte('created_at', dayStart).lte('created_at', dayEnd);
  const { data: pkgPays } = await sb.from('package_payments')
    .select('amount, payment_type, created_at, accounting_date')
    .eq('clinic_id', cid).gte('created_at', dayStart).lte('created_at', dayEnd);
  const { data: manual } = await sb.from('closing_manual_payments')
    .select('amount, payment_type, created_at, close_date')
    .eq('clinic_id', cid).gte('created_at', dayStart).lte('created_at', dayEnd);

  const dayclose_createdAt = net(pays ?? []) + net(pkgPays ?? []) + net(manual ?? []);
  console.log('\n=== View A: 일마감 결제내역 (created_at 수납 grain, ALL) ===');
  console.log('  payments net       =', net(pays ?? []).toLocaleString(), `(${(pays ?? []).length})`);
  console.log('  package_payments   =', net(pkgPays ?? []).toLocaleString(), `(${(pkgPays ?? []).length})`);
  console.log('  closing_manual     =', net(manual ?? []).toLocaleString(), `(${(manual ?? []).length})`);
  console.log('  일마감 TOTAL(created_at) =', dayclose_createdAt.toLocaleString());

  // 4) 축 분해: 같은 테이블을 accounting_date 로 재집계 (WHEN 축 격차 격리)
  const { data: paysAcc } = await sb.from('payments')
    .select('amount, payment_type, accounting_date')
    .eq('clinic_id', cid).gte('accounting_date', from).lte('accounting_date', to);
  const { data: pkgPaysAcc } = await sb.from('package_payments')
    .select('amount, payment_type, accounting_date')
    .eq('clinic_id', cid).gte('accounting_date', from).lte('accounting_date', to);
  const dayclose_acc = net(paysAcc ?? []) + net(pkgPaysAcc ?? []);
  console.log('\n=== 축 분해 ===');
  console.log('  payments+pkg by accounting_date (ALL, no consultant filter) =', dayclose_acc.toLocaleString());
  console.log('  → View B(accounting_date, consultant-attributed only)       =', rpcTotal.toLocaleString());
  console.log('  Δ(scope: consultant-귀속 only vs ALL)  =', (dayclose_acc - rpcTotal).toLocaleString());
  console.log('  Δ(WHEN: created_at vs accounting_date) =', (dayclose_createdAt - dayclose_acc).toLocaleString());
  console.log('\n  TOTAL Δ (일마감 created_at ALL  −  View B) =', (dayclose_createdAt - rpcTotal).toLocaleString());
}
main().catch(e => { console.error(e); process.exit(1); });
