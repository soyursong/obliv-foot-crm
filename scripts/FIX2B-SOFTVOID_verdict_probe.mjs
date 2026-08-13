/**
 * T-20260811-foot-CONSULTANT-REVENUE-FIX2B-SOFTVOID — supervisor 판정시각 READ-ONLY prod probe.
 * money-path DB-GATE GO-token 판정 근거(verdict-time ground-truth). SELECT only.
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
const TARGET = "'2dedc31e-109d-46c6-b592-afe25b8d46b0','1799c939-a810-481d-ae41-1d50937e180b','ea1f5000-b48c-4ddd-9faa-23925a27d40f'";
const PHANTOM = "'d05b5a95-4de3-4f71-a018-932e1ef11adf','4385ba22-be39-48f4-9386-ddcc7086c22a','9d8c6f77-dbe0-40c1-a024-5b33b23fb035'";

// 1) C20 apply_before_go — 3 대상행 현재 상태(아직 active·cancelled_by NULL 이어야 미기입)
out.target_rows = await q(`
  SELECT id, status, payment_type, memo, amount, customer_id, check_in_id,
         linked_payment_id, service_charge_id, cancelled_by, cancelled_at
  FROM public.payments WHERE id IN (${TARGET}) ORDER BY amount;`);

// 2) DISPOSITIVE — linked phantom 3행이 실제 cancelled(MATAEMIN)인지
out.phantom_rows = await q(`
  SELECT id, status, payment_type, amount, cancelled_by, cancelled_at
  FROM public.payments WHERE id IN (${PHANTOM}) ORDER BY amount;`);

// 3) blast-radius — fingerprint 술어에 매칭되는 전체 행 수(정확히 3이어야 freeze 완전)
out.fingerprint_matchset = await q(`
  SELECT count(*) AS n, COALESCE(sum(amount),0) AS sum_amount
  FROM public.payments
  WHERE customer_id='c18b7fd4-1183-4fa1-8aa3-442a65ee24d2'
    AND payment_type='refund' AND memo='crm오류' AND status='active'
    AND check_in_id='3c69ac66-63e3-451d-ae42-33a8ef88a1b3'
    AND linked_payment_id IN (${PHANTOM});`);

// 4) up.sql 술어 (id IN target + 지문) 로 매칭되는 정확한 집합 = 정확히 target 3 인지
out.exact_predicate = await q(`
  SELECT id, status, amount FROM public.payments
  WHERE id IN (${TARGET})
    AND customer_id='c18b7fd4-1183-4fa1-8aa3-442a65ee24d2'
    AND payment_type='refund' AND memo='crm오류' AND status='active'
    AND check_in_id='3c69ac66-63e3-451d-ae42-33a8ef88a1b3'
    AND linked_payment_id IN (${PHANTOM})
  ORDER BY amount;`);

// 5) SSOT 방화벽 — schema_migrations 20260812150000 미등재 확인(ledger 3자)
out.ledger = await q(`
  SELECT count(*) AS applied FROM supabase_migrations.schema_migrations WHERE version='20260812150000';`);

console.log(JSON.stringify(out, null, 2));
