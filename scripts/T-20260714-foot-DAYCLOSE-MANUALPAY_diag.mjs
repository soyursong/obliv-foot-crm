/**
 * T-20260714-foot-DAYCLOSE-MANUAL-PAY-CUSTBOX-UNPAID-SYNC — READ-ONLY diagnosis
 * 목적: F-4695 이미현 실상태 규명 (closing_manual_payments vs payments vs check_ins vs packages).
 *   RC 가설 (a)payments 미생성 / (b)트리거 누락 / (c)집계뷰 누락 中 특정.
 * READ-ONLY (SELECT only). author: dev-foot / 2026-07-14
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

// 1) 이미현 / F-4695 고객 레코드
out.customer = await q(`
  SELECT id, chart_number, name, phone, clinic_id, visit_type, assigned_staff_id, created_at
  FROM public.customers
  WHERE chart_number = 'F-4695' OR name = '이미현'
  ORDER BY created_at DESC LIMIT 10;`);

// 2) closing_manual_payments — 2026-07-14 이미현/F-4695 수기 카드결제
out.manual = await q(`
  SELECT id, clinic_id, close_date, pay_time, chart_number, customer_name, staff_name,
         amount, method, memo, created_at
  FROM public.closing_manual_payments
  WHERE close_date = '2026-07-14'
    AND (chart_number = 'F-4695' OR customer_name = '이미현')
  ORDER BY created_at DESC;`);

// 3) closing_manual_payments 스키마 — customer_id 컬럼 존재 여부(연동 앵커 확인)
out.manual_cols = await q(`
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='closing_manual_payments'
  ORDER BY ordinal_position;`);

// 4) payments 스키마 — check_in_id / customer_id nullable 확인
out.payments_cols = await q(`
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='payments'
  ORDER BY ordinal_position;`);

// 5) payments — 이미현 customer_id 기준 (chart #2 수납내역이 읽는 경로)
out.payments = await q(`
  SELECT p.id, p.customer_id, p.check_in_id, p.amount, p.method, p.payment_type,
         p.memo, p.created_at
  FROM public.payments p
  JOIN public.customers c ON c.id = p.customer_id
  WHERE c.chart_number = 'F-4695' OR c.name = '이미현'
  ORDER BY p.created_at DESC LIMIT 30;`);

// 6) check_ins — 이미현 payment_waiting 여부(미수 앵커 후보)
out.checkins = await q(`
  SELECT ci.id, ci.status, ci.checked_in_at, ci.customer_id, ci.customer_name
  FROM public.check_ins ci
  JOIN public.customers c ON c.id = ci.customer_id
  WHERE (c.chart_number = 'F-4695' OR c.name = '이미현')
    AND ci.checked_in_at >= '2026-07-13T00:00:00+09:00'
  ORDER BY ci.checked_in_at DESC LIMIT 20;`);

// 7) packages / package_payments — outstanding(고객박스 미수) 산출 소스
out.packages = await q(`
  SELECT pk.id, pk.package_name, pk.status, pk.total_amount, pk.consultation_fee,
         pk.paid_amount, pk.total_sessions, pk.created_at
  FROM public.packages pk
  JOIN public.customers c ON c.id = pk.customer_id
  WHERE c.chart_number = 'F-4695' OR c.name = '이미현'
  ORDER BY pk.created_at DESC LIMIT 20;`);

out.package_payments = await q(`
  SELECT pp.id, pp.package_id, pp.amount, pp.method, pp.payment_type, pp.fee_kind, pp.created_at
  FROM public.package_payments pp
  JOIN public.customers c ON c.id = pp.customer_id
  WHERE c.chart_number = 'F-4695' OR c.name = '이미현'
  ORDER BY pp.created_at DESC LIMIT 30;`);

// 8) payments 테이블에 write 시 자동 트리거 존재 여부(미수/상태 갱신 트리거 (b)가설)
out.payments_triggers = await q(`
  SELECT tgname, pg_get_triggerdef(t.oid) AS def
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relname IN ('payments','closing_manual_payments')
    AND NOT t.tgisinternal;`);

console.log(JSON.stringify(out, null, 2));
