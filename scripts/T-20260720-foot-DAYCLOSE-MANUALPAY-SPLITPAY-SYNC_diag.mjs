/**
 * T-20260720-foot-DAYCLOSE-MANUALPAY-SPLITPAY-SYNC — READ-ONLY diagnosis
 * 목적: F-4717 현은호 분할결제(카드+이체) 미수 잔존 실상태 규명.
 *   RC 가설 (a)한 leg만 기록 / (b)둘 다 누락 / (c)closing_manual_payments 만 기록·canonical 미생성 中 특정.
 *   + RETRO-BACKFILL 대상셋 중복 여부 확인용 스냅샷.
 * READ-ONLY (SELECT only). author: dev-foot / 2026-07-20
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const out = {};

// 1) 현은호 / F-4717 고객 레코드
out.customer = await q(`
  SELECT id, chart_number, name, phone, clinic_id, visit_type, assigned_staff_id, created_at
  FROM public.customers
  WHERE chart_number = 'F-4717' OR name = '현은호'
  ORDER BY created_at DESC LIMIT 10;`);

// 2) closing_manual_payments — 현은호/F-4717 수기 결제 (카드+이체 2 leg 확인)
out.manual = await q(`
  SELECT id, clinic_id, close_date, pay_time, chart_number, customer_name, staff_name,
         amount, method, memo, created_at, voided_at
  FROM public.closing_manual_payments
  WHERE (chart_number = 'F-4717' OR customer_name = '현은호')
  ORDER BY close_date DESC, created_at DESC;`);

// 3) payments — 현은호 customer_id 기준 (chart #2 수납내역이 읽는 경로)
out.payments = await q(`
  SELECT p.id, p.customer_id, p.check_in_id, p.amount, p.method, p.payment_type,
         p.memo, p.created_at
  FROM public.payments p
  JOIN public.customers c ON c.id = p.customer_id
  WHERE c.chart_number = 'F-4717' OR c.name = '현은호'
  ORDER BY p.created_at DESC LIMIT 30;`);

// 4) check_ins — 현은호 payment_waiting 여부(미수 앵커 후보)
out.checkins = await q(`
  SELECT ci.id, ci.status, ci.checked_in_at, ci.customer_id, ci.customer_name
  FROM public.check_ins ci
  JOIN public.customers c ON c.id = ci.customer_id
  WHERE (c.chart_number = 'F-4717' OR c.name = '현은호')
  ORDER BY ci.checked_in_at DESC LIMIT 20;`);

// 5) packages / package_payments — outstanding(고객박스 미수) 산출 소스
out.packages = await q(`
  SELECT pk.id, pk.package_name, pk.status, pk.total_amount, pk.consultation_fee,
         pk.paid_amount, pk.total_sessions, pk.created_at
  FROM public.packages pk
  JOIN public.customers c ON c.id = pk.customer_id
  WHERE c.chart_number = 'F-4717' OR c.name = '현은호'
  ORDER BY pk.created_at DESC LIMIT 20;`);

out.package_payments = await q(`
  SELECT pp.id, pp.package_id, pp.amount, pp.method, pp.payment_type, pp.fee_kind,
         pp.memo, pp.created_at
  FROM public.package_payments pp
  JOIN public.customers c ON c.id = pp.customer_id
  WHERE c.chart_number = 'F-4717' OR c.name = '현은호'
  ORDER BY pp.created_at DESC LIMIT 30;`);

// 6) reservations — 현은호 (미수 표시 경로 후보)
out.reservations = await q(`
  SELECT r.id, r.status, r.reservation_date, r.customer_id, r.created_at
  FROM public.reservations r
  JOIN public.customers c ON c.id = r.customer_id
  WHERE c.chart_number = 'F-4717' OR c.name = '현은호'
  ORDER BY r.created_at DESC LIMIT 20;`);

console.log(JSON.stringify(out, null, 2));
