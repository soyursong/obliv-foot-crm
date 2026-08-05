/**
 * T-20260725-foot-SALESLIST-MISSING-RECORDS-BACKFILL — AC-1 READ-ONLY prod census (SELECT만, write 0)
 *
 * 목적: 김규리 CTB 3건(F-4550 이영수·F-5016 김미성·F-4906 백연재)의 행별 실행경로를
 *   prod 실측으로 확정(blanket 3-INSERT 금지). rwrj 행별 3분기 판정 근거 스냅샷.
 *   - customer resolve (chart→id)
 *   - 김규리 staff row resolve (therapist 3a0c6774 후보 vs admin d26717cb)
 *   - 풋화장품 CTB service_id 식별
 *   - 각 고객 check_ins / check_in_services(CTB 라인 기존재?) / payments 전수
 *   - 멱등 HARD: (차트+제품+판매일+금액) 기존재 여부
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CHARTS = ['F-4550', 'F-5016', 'F-4906'];
const p = (...a) => console.log(...a);

async function main() {
  // ── 0) clinic ──
  const { data: clinics } = await sb.from('clinics').select('id, name');
  p('=== clinics ===', JSON.stringify(clinics));
  const clinicId = clinics?.[0]?.id;

  // ── 1) 김규리 staff rows ──
  p('\n=== 김규리 staff rows ===');
  const { data: staff, error: stErr } = await sb.from('staff')
    .select('id, name, role, active, clinic_id')
    .eq('name', '김규리');
  if (stErr) p('staff err', stErr);
  p(JSON.stringify(staff, null, 2));

  // ── 2) 풋화장품 CTB service ──
  p('\n=== 풋화장품 services (CTB 후보) ===');
  const { data: svc } = await sb.from('services')
    .select('id, name, price, category, category_label, active, clinic_id')
    .or('category.eq.풋화장품,category_label.eq.풋화장품');
  p(JSON.stringify(svc, null, 2));

  // ── 3) customers resolve ──
  p('\n=== customers resolve ===');
  const { data: custs } = await sb.from('customers')
    .select('id, name, chart_number, clinic_id')
    .in('chart_number', CHARTS);
  p(JSON.stringify(custs, null, 2));
  const custMap = Object.fromEntries((custs ?? []).map((c) => [c.chart_number, c]));

  // ── 4) per-customer 실측 ──
  for (const chart of CHARTS) {
    const c = custMap[chart];
    p(`\n\n######## ${chart} ${c?.name ?? '(MISSING!)'} id=${c?.id ?? 'NULL'} ########`);
    if (!c) { p('  ⚠ customer resolve FAILED'); continue; }

    // check_ins
    const { data: cis } = await sb.from('check_ins')
      .select('id, checked_in_at, therapist_id, clinic_id, status')
      .eq('customer_id', c.id)
      .order('checked_in_at', { ascending: true });
    p(`  --- check_ins (${cis?.length ?? 0}) ---`);
    for (const ci of cis ?? []) p(`    ci=${ci.id} at=${ci.checked_in_at} ther=${ci.therapist_id} st=${ci.status}`);

    const ciIds = (cis ?? []).map((x) => x.id);

    // check_in_services (all lines for this customer's check_ins)
    if (ciIds.length) {
      const { data: lines } = await sb.from('check_in_services')
        .select('id, check_in_id, service_id, service_name, price, original_price, seller_staff_id, voided_at, created_at')
        .in('check_in_id', ciIds);
      p(`  --- check_in_services (${lines?.length ?? 0}) ---`);
      for (const l of lines ?? [])
        p(`    line=${l.id} name="${l.service_name}" price=${l.price} svc=${l.service_id} seller=${l.seller_staff_id} void=${l.voided_at} ci=${l.check_in_id}`);
    }

    // payments (all for this customer)
    const { data: pays } = await sb.from('payments')
      .select('id, check_in_id, customer_id, amount, method, payment_type, accounting_date, origin_tx_date, appr_info, memo, created_at, clinic_id')
      .eq('customer_id', c.id)
      .order('accounting_date', { ascending: true });
    p(`  --- payments by customer_id (${pays?.length ?? 0}) ---`);
    for (const pm of pays ?? [])
      p(`    pay=${pm.id} amt=${pm.amount} ${pm.method}/${pm.payment_type} acct=${pm.accounting_date} ci=${pm.check_in_id} appr=${pm.appr_info ?? '-'} memo=${(pm.memo ?? '').slice(0,40)}`);

    // payments by check_in_id (in case customer_id null on payment)
    if (ciIds.length) {
      const { data: paysCi } = await sb.from('payments')
        .select('id, check_in_id, customer_id, amount, method, payment_type, accounting_date, created_at')
        .in('check_in_id', ciIds);
      p(`  --- payments by check_in_id (${paysCi?.length ?? 0}) ---`);
      for (const pm of paysCi ?? [])
        p(`    pay=${pm.id} amt=${pm.amount} ${pm.method}/${pm.payment_type} acct=${pm.accounting_date} ci=${pm.check_in_id} cust=${pm.customer_id}`);
    }

    // 멱등 HARD: CTB 15,000 라인 기존재 여부
    if (ciIds.length) {
      const { data: ctbLines } = await sb.from('check_in_services')
        .select('id, service_name, price, seller_staff_id, voided_at, check_in_id')
        .in('check_in_id', ciIds)
        .eq('price', 15000);
      p(`  --- ⚑ 멱등: price=15000 라인 (${ctbLines?.length ?? 0}) ---`);
      for (const l of ctbLines ?? [])
        p(`    line=${l.id} name="${l.service_name}" seller=${l.seller_staff_id} void=${l.voided_at}`);
    }
  }

  // ── 5) payments 컬럼 스키마 (샘플 1행 keys) ──
  p('\n=== payments schema (sample row keys) ===');
  const { data: sample } = await sb.from('payments').select('*').limit(1);
  p(sample?.[0] ? Object.keys(sample[0]).join(', ') : '(no rows)');
}

main().then(() => { p('\n[census done]'); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
