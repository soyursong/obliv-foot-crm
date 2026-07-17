/**
 * T-20260717-foot-CLOSING-REFUND-STATS-MISSING — READ-ONLY PROBE (no writes)
 * 일마감 통계에 금일 환불 건 미반영 RCA.
 * 재현 케이스: 차트번호 F-4840, 고객명 홍미옥, 환불 350,000원, 발생일 2026-07-17.
 * 종로점(jongno-foot). 목적: 환불 레코드가 어디서 탈락하는지 실측.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })());
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const DAY = '2026-07-17';

// KST day bounds → UTC ISO (dayBoundsISO 등가: KST 00:00~23:59:59.999)
const start = new Date(`${DAY}T00:00:00+09:00`).toISOString();
const end   = new Date(`${DAY}T23:59:59.999+09:00`).toISOString();
console.log(`KST ${DAY} → created_at range [${start} , ${end}]`);

// 1) 고객 찾기 (차트번호 F-4840 / 이름 홍미옥)
const { data: custs, error: cErr } = await sb
  .from('customers')
  .select('id, name, chart_number, clinic_id, assigned_staff_id')
  .eq('clinic_id', CLINIC_ID)
  .or('chart_number.eq.F-4840,chart_number.eq.4840,name.eq.홍미옥');
if (cErr) { console.error('customers query fail', cErr); process.exit(1); }
console.log(`\n=== 고객 후보 ${custs.length}건 ===`);
for (const c of custs) console.log(`  ${c.chart_number} | ${c.name} | id=${c.id} | assigned_staff_id=${c.assigned_staff_id}`);

const target = custs.find(c => c.chart_number === 'F-4840') || custs.find(c => c.name === '홍미옥') || custs[0];
if (!target) { console.log('대상 고객 없음 — 종료'); process.exit(0); }
console.log(`\n>>> 대상: ${target.chart_number} ${target.name} (id=${target.id})`);

// 2) 이 고객의 전체 payments (기간 무관, 환불 포함)
const { data: pays } = await sb
  .from('payments')
  .select('id, amount, method, payment_type, status, created_at, accounting_date, check_in_id, linked_payment_id, memo')
  .eq('clinic_id', CLINIC_ID)
  .eq('customer_id', target.id)
  .order('created_at', { ascending: true });
console.log(`\n=== payments (단건) 전체 ${pays?.length ?? 0}건 ===`);
for (const p of pays ?? []) {
  const inDay = p.created_at >= start && p.created_at <= end;
  console.log(`  [${p.payment_type}] ${p.amount} ${p.method} status=${p.status} created_at=${p.created_at} acct=${p.accounting_date} linked=${p.linked_payment_id} inTodayCreatedAt=${inDay} memo=${(p.memo||'').slice(0,30)}`);
}

// 3) 이 고객의 package_payments (기간 무관, 환불 포함)
const { data: pkgs } = await sb
  .from('package_payments')
  .select('id, package_id, amount, method, payment_type, status, created_at, parent_payment_id')
  .eq('clinic_id', CLINIC_ID)
  .eq('customer_id', target.id)
  .order('created_at', { ascending: true });
console.log(`\n=== package_payments (패키지) 전체 ${pkgs?.length ?? 0}건 ===`);
for (const p of pkgs ?? []) {
  const inDay = p.created_at >= start && p.created_at <= end;
  console.log(`  [${p.payment_type}] ${p.amount} ${p.method} status=${p.status ?? 'n/a'} created_at=${p.created_at} parent=${p.parent_payment_id} inTodayCreatedAt=${inDay}`);
}

// 4) 오늘(created_at 기준) clinic 전체 환불행 존재 여부 — Closing 쿼리와 동일 필터
const { data: todayRefundsSingle } = await sb
  .from('payments')
  .select('id, customer_id, amount, method, status, created_at, linked_payment_id')
  .eq('clinic_id', CLINIC_ID)
  .eq('payment_type', 'refund')
  .gte('created_at', start).lte('created_at', end);
console.log(`\n=== 오늘(created_at) 단건 환불행 clinic 전체: ${todayRefundsSingle?.length ?? 0}건 ===`);
for (const r of todayRefundsSingle ?? []) console.log(`  cust=${r.customer_id} amt=${r.amount} status=${r.status} created_at=${r.created_at} linked=${r.linked_payment_id}`);

const { data: todayRefundsPkg } = await sb
  .from('package_payments')
  .select('id, customer_id, amount, method, status, created_at, parent_payment_id')
  .eq('clinic_id', CLINIC_ID)
  .eq('payment_type', 'refund')
  .gte('created_at', start).lte('created_at', end);
console.log(`\n=== 오늘(created_at) 패키지 환불행 clinic 전체: ${todayRefundsPkg?.length ?? 0}건 ===`);
for (const r of todayRefundsPkg ?? []) console.log(`  cust=${r.customer_id} amt=${r.amount} status=${r.status ?? 'n/a'} created_at=${r.created_at} parent=${r.parent_payment_id}`);

// 5) 이 고객 refund 행이 있으면, 그 원결제행 created_at 이 언제인지 (교차일 여부)
const custRefunds = [...(pays??[]).filter(p=>p.payment_type==='refund'), ...(pkgs??[]).filter(p=>p.payment_type==='refund')];
console.log(`\n=== 대상 고객 환불행 ${custRefunds.length}건 — 환불 created_at vs 원결제 created_at ===`);
for (const r of custRefunds) {
  const inDay = r.created_at >= start && r.created_at <= end;
  console.log(`  환불 amt=${r.amount} created_at=${r.created_at} (오늘?${inDay})`);
}
console.log('\n=== PROBE DONE ===');
