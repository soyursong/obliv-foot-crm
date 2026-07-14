/**
 * T-20260714-foot-SAMEDAY-MANUALPAY-REMAP-UNPAID-CLEAN — Phase 1a READ-ONLY schema introspection.
 * 목적: 수기수납(closing_manual_payments) / 수납내역(payments,payment_items) / 미수이력 / 차트(medical_charts)
 *   관련 테이블 컬럼구조를 확인해 Phase 1b 데이터 조회 SQL을 정확히 작성한다. SELECT/introspection only.
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

// 1) 관련 테이블별 컬럼 목록
out.columns = await q(`
  SELECT table_name, column_name, data_type
  FROM information_schema.columns
  WHERE table_schema='public'
    AND table_name IN ('closing_manual_payments','payments','payment_items','service_charges',
                       'check_ins','medical_charts','packages','package_payments','package_sessions',
                       'reservations','customers','payment_reconciliation_log')
  ORDER BY table_name, ordinal_position;
`);

// 2) 미수/unpaid 성격 컬럼 전역 탐색 (테이블 무관)
out.unpaid_like_cols = await q(`
  SELECT table_name, column_name, data_type
  FROM information_schema.columns
  WHERE table_schema='public'
    AND (column_name ILIKE '%unpaid%' OR column_name ILIKE '%misu%' OR column_name ILIKE '%arrear%'
         OR column_name ILIKE '%outstanding%' OR column_name ILIKE '%balance%' OR column_name ILIKE '%receiv%'
         OR column_name ILIKE '%due%' OR column_name ILIKE '%status%')
  ORDER BY table_name, column_name;
`);

// 3) "미수이력" 성격 테이블 탐색 (한글/영문 후보)
out.candidate_tables = await q(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public'
    AND (table_name ILIKE '%receiv%' OR table_name ILIKE '%unpaid%' OR table_name ILIKE '%misu%'
         OR table_name ILIKE '%arrear%' OR table_name ILIKE '%balance%' OR table_name ILIKE '%ledger%'
         OR table_name ILIKE '%due%')
  ORDER BY table_name;
`);

console.log(JSON.stringify(out, null, 2));
