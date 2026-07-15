/**
 * T-20260715-foot-DAYCLOSE-PAYGATE-RC-REPRO — F-4714 단건 row-level 정밀 진단 (READ-ONLY)
 * 목적: F-4714(총괄테스트 차트)가 일마감 결제목록에 노출되는지, 실결제 3종 소스에 행이 실재하는지 확정.
 * 절대 write 없음 (SELECT only via supabase-js service_role).
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

function readEnv(k) {
  for (const f of ['.env.local', '.env']) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(new RegExp('^' + k + '=(.*)$'));
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return process.env[k];
}

const URL = readEnv('VITE_SUPABASE_URL');
const KEY = readEnv('SUPABASE_SERVICE_ROLE_KEY');
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const CHART = 'F-4714';
const j = (o) => JSON.stringify(o, null, 2);
console.log(`=== F-4714 probe @ ${URL} ===\n`);

// 1) customers: chart_number = F-4714
let { data: custs, error: cErr } = await sb
  .from('customers')
  .select('id, chart_number, name, visit_type, visit_route, assigned_staff_id, clinic_id, created_at')
  .eq('chart_number', CHART);
if (cErr) console.log('customers err:', cErr.message);
console.log(`[customers] chart_number=${CHART} → ${custs?.length ?? 0}건`);
console.log(j(custs));

if (!custs?.length) {
  // fallback: chart_number LIKE (혹시 포맷 상이)
  const alt = await sb.from('customers').select('id, chart_number, name, visit_type, clinic_id')
    .ilike('chart_number', '%4714%');
  console.log(`[customers fallback ilike %4714%] → ${alt.data?.length ?? 0}건`);
  console.log(j(alt.data));
}

const custIds = (custs ?? []).map(c => c.id);
if (!custIds.length) { console.log('\n⚠ customer 없음 — 종료'); process.exit(0); }

// 2) check_ins for this customer
const { data: cis, error: ciErr } = await sb
  .from('check_ins')
  .select('id, customer_id, customer_name, visit_type, status, status_flag, checked_in_at, completed_at, clinic_id, created_at')
  .in('customer_id', custIds)
  .order('checked_in_at', { ascending: false });
if (ciErr) console.log('check_ins err:', ciErr.message);
console.log(`\n[check_ins] → ${cis?.length ?? 0}건`);
console.log(j(cis));
const ciIds = (cis ?? []).map(c => c.id);

// 2b) status_transitions (테이블명 후보 시도)
for (const t of ['status_transitions', 'check_in_status_transitions', 'check_in_status_logs']) {
  const r = await sb.from(t).select('*').in('check_in_id', ciIds.length ? ciIds : ['00000000-0000-0000-0000-000000000000']).limit(50);
  if (!r.error) { console.log(`\n[${t}] → ${r.data?.length ?? 0}건`); console.log(j(r.data)); }
}

// 3) 실결제 3종 소스 — customer_id / check_in_id 기준
const { data: pays } = await sb.from('payments')
  .select('id, customer_id, check_in_id, amount, method, payment_type, voided_at, created_at, clinic_id')
  .or(`customer_id.in.(${custIds.join(',')})${ciIds.length ? `,check_in_id.in.(${ciIds.join(',')})` : ''}`);
console.log(`\n[payments] → ${pays?.length ?? 0}건`);
console.log(j(pays));

const { data: pkgPays } = await sb.from('package_payments')
  .select('id, customer_id, package_id, amount, method, payment_type, created_at, clinic_id')
  .in('customer_id', custIds);
console.log(`\n[package_payments] → ${pkgPays?.length ?? 0}건`);
console.log(j(pkgPays));

// closing_manual_payments: customer_id 없을 수 있음 → chart_number/name 기준
const { data: manual } = await sb.from('closing_manual_payments')
  .select('*')
  .or(`chart_number.eq.${CHART}${custIds.length ? '' : ''}`);
console.log(`\n[closing_manual_payments chart=${CHART}] → ${manual?.length ?? 0}건`);
console.log(j(manual));

// 4) check_in_services (시술/price 행)
if (ciIds.length) {
  const { data: cisvc } = await sb.from('check_in_services')
    .select('id, check_in_id, service_name, price, is_package_session, created_at')
    .in('check_in_id', ciIds);
  console.log(`\n[check_in_services] → ${cisvc?.length ?? 0}건`);
  console.log(j(cisvc));
}

console.log('\n=== PROBE END ===');
process.exit(0);
