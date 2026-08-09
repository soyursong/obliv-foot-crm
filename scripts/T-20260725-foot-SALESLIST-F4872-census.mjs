/**
 * T-20260725-foot-SALESLIST-MISSING-RECORDS-BACKFILL — F-4872 census (READ-ONLY, SELECT만, write 0)
 *
 * 목적: F-4872 김정숙 풋샴푸(200ml) 42,000 임별 카드 backfill 의 rwrj 행별 3분기 확정.
 *   nph2 confirm 도달(실수금 YES·카드·7/18·임별) → 분기① 후보. 단 prod 실측으로 최종 확정.
 *   - customer resolve (F-4872 → id)
 *   - 임별 staff row resolve (김규리처럼 중복 active staff 여부 확인)
 *   - 풋샴푸(200ml) service_id 식별 + 비급여(service_charge NULL) 정합
 *   - check_ins / check_in_services(풋샴푸 라인 기존재?) / payments(42,000 card, 7/18 전후) 전수
 *   - 멱등 HARD: (차트+제품+금액) 기존재 여부
 *   - 골든 853cbcec(F-4906 CTB) service_charge_id NULL 정합 참조
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CHART = 'F-4872';
const p = (...a) => console.log(...a);

async function main() {
  // ── 0) clinic ──
  const { data: clinics } = await sb.from('clinics').select('id, name');
  p('=== clinics ===', JSON.stringify(clinics));

  // ── 1) 임별 staff rows (중복 active 여부) ──
  p('\n=== 임별 staff rows (중복 active 확인) ===');
  const { data: staff, error: stErr } = await sb.from('staff')
    .select('id, name, role, active, clinic_id')
    .eq('name', '임별');
  if (stErr) p('staff err', stErr);
  p(JSON.stringify(staff, null, 2));

  // ── 2) 풋화장품 services (풋샴푸 후보) ──
  p('\n=== 풋화장품 services (풋샴푸 200ml 후보) ===');
  const { data: svc } = await sb.from('services')
    .select('id, name, price, category, category_label, active, clinic_id')
    .or('category.eq.풋화장품,category_label.eq.풋화장품');
  p(JSON.stringify(svc, null, 2));

  // 42,000 가격 service 도 조회 (풋샴푸 200ml)
  p('\n=== price=42000 services ===');
  const { data: svc42 } = await sb.from('services')
    .select('id, name, price, category, category_label, active, clinic_id')
    .eq('price', 42000);
  p(JSON.stringify(svc42, null, 2));

  // ── 3) customer resolve ──
  p('\n=== customer resolve ===');
  const { data: custs } = await sb.from('customers')
    .select('id, name, chart_number, clinic_id')
    .eq('chart_number', CHART);
  p(JSON.stringify(custs, null, 2));
  const c = (custs ?? [])[0];

  if (!c) { p('  ⚠ customer resolve FAILED — ABORT 근거'); return; }

  p(`\n\n######## ${CHART} ${c.name} id=${c.id} clinic=${c.clinic_id} ########`);

  // check_ins
  const { data: cis } = await sb.from('check_ins')
    .select('id, checked_in_at, therapist_id, clinic_id, status')
    .eq('customer_id', c.id)
    .order('checked_in_at', { ascending: true });
  p(`  --- check_ins (${cis?.length ?? 0}) ---`);
  for (const ci of cis ?? []) p(`    ci=${ci.id} at=${ci.checked_in_at} ther=${ci.therapist_id} st=${ci.status}`);
  const ciIds = (cis ?? []).map((x) => x.id);

  // check_in_services (all lines)
  if (ciIds.length) {
    const { data: lines } = await sb.from('check_in_services')
      .select('id, check_in_id, service_id, service_name, price, original_price, seller_staff_id, service_charge_id, voided_at, created_at')
      .in('check_in_id', ciIds);
    p(`  --- check_in_services (${lines?.length ?? 0}) ---`);
    for (const l of lines ?? [])
      p(`    line=${l.id} name="${l.service_name}" price=${l.price} svc=${l.service_id} seller=${l.seller_staff_id} sc_id=${l.service_charge_id} void=${l.voided_at} ci=${l.check_in_id}`);
  }

  // payments by customer_id
  const { data: pays } = await sb.from('payments')
    .select('id, check_in_id, customer_id, amount, method, payment_type, accounting_date, origin_tx_date, appr_info, memo, status, created_at, clinic_id')
    .eq('customer_id', c.id)
    .order('accounting_date', { ascending: true });
  p(`  --- payments by customer_id (${pays?.length ?? 0}) ---`);
  for (const pm of pays ?? [])
    p(`    pay=${pm.id} amt=${pm.amount} ${pm.method}/${pm.payment_type} st=${pm.status} acct=${pm.accounting_date} otx=${pm.origin_tx_date ?? '-'} ci=${pm.check_in_id} appr=${pm.appr_info ?? '-'} memo=${(pm.memo ?? '').slice(0,50)}`);

  // payments by check_in_id (customer_id null 대비)
  if (ciIds.length) {
    const { data: paysCi } = await sb.from('payments')
      .select('id, check_in_id, customer_id, amount, method, payment_type, accounting_date, status, created_at')
      .in('check_in_id', ciIds);
    p(`  --- payments by check_in_id (${paysCi?.length ?? 0}) ---`);
    for (const pm of paysCi ?? [])
      p(`    pay=${pm.id} amt=${pm.amount} ${pm.method}/${pm.payment_type} st=${pm.status} acct=${pm.accounting_date} ci=${pm.check_in_id} cust=${pm.customer_id}`);
  }

  // 멱등 HARD: 풋샴푸/42,000 라인 기존재 여부
  if (ciIds.length) {
    const { data: shampooLines } = await sb.from('check_in_services')
      .select('id, service_name, price, seller_staff_id, voided_at, check_in_id')
      .in('check_in_id', ciIds)
      .eq('price', 42000);
    p(`  --- ⚑ 멱등: price=42000 라인 (${shampooLines?.length ?? 0}) ---`);
    for (const l of shampooLines ?? [])
      p(`    line=${l.id} name="${l.service_name}" seller=${l.seller_staff_id} void=${l.voided_at}`);

    const { data: pay42 } = await sb.from('payments')
      .select('id, amount, method, payment_type, accounting_date, status, check_in_id')
      .in('check_in_id', ciIds)
      .eq('amount', 42000);
    p(`  --- ⚑ 멱등: amount=42000 payment (${pay42?.length ?? 0}) ---`);
    for (const pm of pay42 ?? [])
      p(`    pay=${pm.id} ${pm.method}/${pm.payment_type} st=${pm.status} acct=${pm.accounting_date} ci=${pm.check_in_id}`);
  }

  // ── 4) 골든 참조: F-4906 CTB line 853cbcec service_charge_id (비급여 NULL 정합) ──
  p('\n=== 골든 참조: 기존 풋화장품 라인 service_charge_id (비급여 NULL 확인) ===');
  const { data: golden } = await sb.from('check_in_services')
    .select('id, service_name, price, service_charge_id, seller_staff_id')
    .eq('price', 15000)
    .limit(5);
  p(JSON.stringify(golden, null, 2));

  // ── 5) payments 스키마 keys ──
  p('\n=== payments schema keys ===');
  const { data: sample } = await sb.from('payments').select('*').limit(1);
  p(sample?.[0] ? Object.keys(sample[0]).join(', ') : '(no rows)');

  // ── 6) check_in_services 스키마 keys ──
  p('\n=== check_in_services schema keys ===');
  const { data: sampleCis } = await sb.from('check_in_services').select('*').limit(1);
  p(sampleCis?.[0] ? Object.keys(sampleCis[0]).join(', ') : '(no rows)');
}

main().then(() => { p('\n[census done]'); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
