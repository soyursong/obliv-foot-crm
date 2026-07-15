// READ-ONLY probe — T-20260715-foot-DAYCLOSE-PAYGATE-RC-REPRO
// F-4714(총괄테스트) row-level 역추적. TASK-1/2/3 (planner 17:17 방향).
// 패치·쓰기 없음. status=approved diagnosis 단계.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const CHART = 'F-4714';

// 0) 차트 → customer
const { data: custs, error: cErr } = await sb
  .from('customers')
  .select('id, name, chart_number, clinic_id, visit_type, assigned_staff_id')
  .eq('chart_number', CHART);
if (cErr) throw cErr;
console.log('=== 0) customers (chart', CHART, ') ===');
console.log(JSON.stringify(custs, null, 2));
const custIds = (custs ?? []).map(c => c.id);

// 1) TASK-1: check_ins for this customer/chart
const { data: cis, error: ciErr } = await sb
  .from('check_ins')
  .select('id, customer_id, customer_name, status, status_flag, visit_type, checked_in_at, completed_at, clinic_id')
  .in('customer_id', custIds.length ? custIds : ['00000000-0000-0000-0000-000000000000'])
  .order('checked_in_at', { ascending: true });
if (ciErr) throw ciErr;
console.log('\n=== 1) check_ins (TASK-1) ===');
console.log(JSON.stringify(cis, null, 2));
const ciIds = (cis ?? []).map(c => c.id);

// status_transitions
const { data: st } = await sb
  .from('status_transitions')
  .select('id, check_in_id, from_status, to_status, created_at')
  .in('check_in_id', ciIds.length ? ciIds : ['00000000-0000-0000-0000-000000000000'])
  .order('created_at', { ascending: true });
console.log('\n=== 1b) status_transitions ===');
console.log(JSON.stringify(st, null, 2));

// 2) TASK-2: closing 3 sources + check_in_services
const { data: pays } = await sb
  .from('payments')
  .select('id, check_in_id, customer_id, amount, method, payment_type, created_at, voided_at')
  .or(`customer_id.in.(${custIds.join(',') || '00000000-0000-0000-0000-000000000000'}),check_in_id.in.(${ciIds.join(',') || '00000000-0000-0000-0000-000000000000'})`);
console.log('\n=== 2a) payments (단건, TASK-2) ===');
console.log(JSON.stringify(pays, null, 2));

const { data: pkgPays } = await sb
  .from('package_payments')
  .select('id, customer_id, package_id, amount, method, payment_type, created_at')
  .in('customer_id', custIds.length ? custIds : ['00000000-0000-0000-0000-000000000000']);
console.log('\n=== 2b) package_payments ===');
console.log(JSON.stringify(pkgPays, null, 2));

// closing_manual_payments — chart_number 기반
const { data: manual } = await sb
  .from('closing_manual_payments')
  .select('id, chart_number, customer_name, amount, method, close_date, clinic_id')
  .eq('chart_number', CHART);
console.log('\n=== 2c) closing_manual_payments (chart', CHART, ') ===');
console.log(JSON.stringify(manual, null, 2));

const { data: cisv } = await sb
  .from('check_in_services')
  .select('id, check_in_id, service_name, price, is_package_session')
  .in('check_in_id', ciIds.length ? ciIds : ['00000000-0000-0000-0000-000000000000']);
console.log('\n=== 2d) check_in_services (TASK-2 시술/price) ===');
console.log(JSON.stringify(cisv, null, 2));

// 3) 판정 요약
console.log('\n=== 3) 판정 요약 (TASK-3) ===');
const realPay = (pays ?? []).filter(p => !p.voided_at).length;
console.log('실결제 payments(voided 제외):', realPay);
console.log('package_payments:', (pkgPays ?? []).length);
console.log('closing_manual_payments:', (manual ?? []).length);
console.log('check_in_services rows:', (cisv ?? []).length,
  '| non-pkg price합:', (cisv ?? []).filter(s => s.is_package_session !== true).reduce((s, r) => s + (r.price || 0), 0));
console.log('done check_ins:', (cis ?? []).filter(c => c.status === 'done').length);
const totalRealPay = realPay + (pkgPays ?? []).length + (manual ?? []).length;
console.log('→ 일마감 결제목록(enrichedRows) 소스 실결제 총행:', totalRealPay);
console.log(totalRealPay === 0
  ? '→ 실결제 0건: enrichedRows에 F-4714 노출 불가(코드상). 현장이 본 줄은 다른 경로/차트일 가능성.'
  : '→ 실결제 존재: A안(정당결제) 후보. 게이트 빼면 매출누락.');
