/**
 * T-20260804-foot-MATAEMIN-PAYMENT-COMPLETE-ROLLBACK — DIAGNOSTIC (READ-ONLY)
 * Phase A: 마태민 고객(08-03 19:36 접수) '결제완료' 오처리 대상행 특정 + 직전상태 규명.
 * 어떤 UPDATE/INSERT/DELETE 도 실행하지 않음. 순수 SELECT 조회만.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })());
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const NAME = '마태민';
const j = (o) => JSON.stringify(o, null, 2);

// ── (1) customers — 동명이인 점검 ──
const { data: custs, error: ce } = await sb.from('customers')
  .select('id, name, phone, chart_number, clinic_id, unified_customer_id, is_simulation, created_at, created_by')
  .eq('name', NAME);
console.log('===== (1) customers name=마태민 =====');
console.log('count:', custs?.length, 'err:', ce?.message);
console.log(j(custs));
const custIds = (custs || []).map(c => c.id);
const orCust = custIds.length ? `,customer_id.in.(${custIds.join(',')})` : '';

// ── (2) reservations — 08-03 접수 ──
const { data: resvs, error: re } = await sb.from('reservations')
  .select('id, customer_id, customer_name, customer_phone, status, reservation_date, reservation_time, source_system, created_via, registrar_name, clinic_id, created_at, updated_at, updated_by')
  .or(`customer_name.eq.${NAME}${orCust}`)
  .order('created_at', { ascending: false }).limit(50);
console.log('\n===== (2) reservations (마태민) =====');
console.log('count:', resvs?.length, 'err:', re?.message);
console.log(j(resvs));

// ── (3) check_ins — 칸반 카드/상태 보유처 + status_flag_history ──
const { data: cis, error: cie } = await sb.from('check_ins')
  .select('id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, status_flag, status_flag_history, checked_in_at, called_at, completed_at, deleted_at, deleted_by, clinic_id, created_at, created_by')
  .or(`customer_name.eq.${NAME}${orCust}`)
  .order('created_at', { ascending: false }).limit(50);
console.log('\n===== (3) check_ins (마태민) — status/status_flag/history =====');
console.log('count:', cis?.length, 'err:', cie?.message);
console.log(j(cis));
const checkInIds = (cis || []).map(c => c.id);

// ── (4) payments — 결제 레코드(결제완료 = active payments row 존재) ──
let payments = [];
if (checkInIds.length || custIds.length) {
  const filters = [];
  if (checkInIds.length) filters.push(`check_in_id.in.(${checkInIds.join(',')})`);
  if (custIds.length) filters.push(`customer_id.in.(${custIds.join(',')})`);
  const { data: pays, error: pe } = await sb.from('payments')
    .select('id, check_in_id, customer_id, amount, method, payment_type, status, is_simulation, created_by, created_at, cancelled_at, cancelled_by, deleted_at, package_id, service_charge_id, clinic_id')
    .or(filters.join(','))
    .order('created_at', { ascending: false }).limit(50);
  payments = pays || [];
  console.log('\n===== (4) payments (마태민 관련) =====');
  console.log('count:', payments.length, 'err:', pe?.message);
  console.log(j(payments));
}
const paymentIds = payments.map(p => p.id);

// ── (5) payment_audit_logs — 오클릭 지문 ──
if (paymentIds.length || checkInIds.length) {
  const filters = [];
  if (paymentIds.length) filters.push(`payment_id.in.(${paymentIds.join(',')})`);
  if (checkInIds.length) filters.push(`check_in_id.in.(${checkInIds.join(',')})`);
  const { data: logs, error: le } = await sb.from('payment_audit_logs')
    .select('id, payment_id, check_in_id, action, actor, reason, before_data, after_data, created_at')
    .or(filters.join(','))
    .order('created_at', { ascending: true }).limit(100);
  console.log('\n===== (5) payment_audit_logs (오클릭 지문: action/actor/before→after/시각) =====');
  console.log('count:', logs?.length, 'err:', le?.message);
  console.log(j(logs));
}

// ── (6) 매출집계 반영 여부 — v_daily_revenue 등 (READ) ──
for (const view of ['v_daily_revenue', 'daily_closings', 'daily_closing_payments']) {
  const { data, error } = await sb.from(view).select('*').limit(3);
  if (!error) {
    console.log(`\n===== (6) ${view} 존재확인(샘플 3) =====`);
    console.log('cols:', data && data[0] ? Object.keys(data[0]).join(', ') : '(empty)');
  } else {
    console.log(`\n(6) ${view}: ${error.message}`);
  }
}

console.log('\n===== DIAG COMPLETE (READ-ONLY, no writes) =====');
