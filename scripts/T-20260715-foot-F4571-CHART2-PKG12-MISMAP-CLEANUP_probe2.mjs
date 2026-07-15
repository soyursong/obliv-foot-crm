/**
 * T-20260715-foot-F4571-CHART2-PKG12-MISMAP-CLEANUP — Phase 1 forensic dump (READ-ONLY).
 * 대상 고객: 한정수 F-4571 = 99784454-1ee5-4c38-b677-7c085b3b19db
 * 목적: packages / package_payments / payments / package_sessions / medical_charts / check_ins
 *   전수 조회로 정상 맵핑 vs 12회권 오등록 지문 판별 근거 수집. SELECT only. 원장 무접점.
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
const CUST = '99784454-1ee5-4c38-b677-7c085b3b19db';
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const out = {};

// medical_charts 스키마 + 이 고객의 차트들 (2번 차트 식별)
out.mc_cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='medical_charts' ORDER BY ordinal_position;`)).map(c=>c.column_name);
out.medical_charts = await q(`SELECT * FROM medical_charts WHERE customer_id='${CUST}' ORDER BY created_at;`);

// packages 전수
out.packages = await q(`
  SELECT id, package_name, package_type, total_sessions, total_amount, paid_amount, status,
         template_id, transferred_from, transferred_to, contract_date, created_by, created_at, updated_at, memo
  FROM packages WHERE customer_id='${CUST}' ORDER BY created_at;`);

// package_payments 전수
out.package_payments = await q(`
  SELECT id, package_id, amount, method, payment_type, installment, vat_amount, tax_type,
         parent_payment_id, accounting_date, origin_tx_date, memo, created_at
  FROM package_payments WHERE customer_id='${CUST}' ORDER BY created_at;`);

// payments 전수 (일반 결제 원장)
out.payments = await q(`
  SELECT id, check_in_id, amount, method, payment_type, status, deleted_at, cancelled_at,
         parent_payment_id, linked_payment_id, accounting_date, origin_tx_date, memo, created_at
  FROM payments WHERE customer_id='${CUST}' ORDER BY created_at;`);

// package_sessions (각 패키지 소진 회차) — 오등록 패키지가 실제 소진됐는지 (net-zero 판단 핵심)
out.package_sessions = await q(`
  SELECT ps.id, ps.package_id, ps.* FROM package_sessions ps
  WHERE ps.package_id IN (SELECT id FROM packages WHERE customer_id='${CUST}')
  ORDER BY ps.package_id;`);

// check_ins referencing 이 고객 패키지 (packages [a] NO ACTION blocker 후보)
out.check_ins_on_pkg = await q(`
  SELECT id, package_id, customer_id, status, created_at FROM check_ins
  WHERE package_id IN (SELECT id FROM packages WHERE customer_id='${CUST}')
  ORDER BY created_at;`);

console.log(JSON.stringify(out, null, 2));
