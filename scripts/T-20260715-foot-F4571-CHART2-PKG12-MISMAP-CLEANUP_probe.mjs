/**
 * T-20260715-foot-F4571-CHART2-PKG12-MISMAP-CLEANUP — Phase 1 forensic (READ-ONLY).
 * 목적: F-4571 한정수 2번 차트의 packages/package_payments/payments 전수 조회 +
 *   관련 테이블 스키마·FK 관계 확인. 정상 맵핑 vs 12회권 오등록 지문 판별의 근거 수집.
 * 파괴 없음. SELECT / information_schema only. 원장 무접점.
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

// 0) 후보 테이블 존재 확인
out.tables = await q(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public'
    AND table_name IN ('customers','packages','package_payments','payments','medical_charts',
                       'package_sessions','package_usages','package_credits','service_charges')
  ORDER BY table_name;
`);

// 1) 대상 고객 식별 — 한정수 / chart_no 4571
out.customer = await q(`
  SELECT id, chart_number, name, phone, visit_type, created_at, created_by, clinic_id
  FROM customers
  WHERE name LIKE '%한정수%' OR chart_number ILIKE '%4571%'
  ORDER BY created_at;
`);

// 2) packages 스키마
out.packages_cols = await q(`
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='packages'
  ORDER BY ordinal_position;
`);

// 3) package_payments 스키마
out.package_payments_cols = await q(`
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='package_payments'
  ORDER BY ordinal_position;
`);

// 4) payments 스키마
out.payments_cols = await q(`
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='payments'
  ORDER BY ordinal_position;
`);

// 5) FK 관계 — packages/package_payments/payments 로 향하거나 나가는 모든 FK (카탈로그 기계열거)
out.fk_map = await q(`
  SELECT
    con.conname,
    src.relname  AS child_table,
    tgt.relname  AS parent_table,
    con.confdeltype AS on_delete,
    pg_get_constraintdef(con.oid) AS def
  FROM pg_constraint con
  JOIN pg_class src ON src.oid = con.conrelid
  JOIN pg_class tgt ON tgt.oid = con.confrelid
  JOIN pg_namespace n ON n.oid = src.relnamespace
  WHERE con.contype='f' AND n.nspname='public'
    AND (src.relname IN ('packages','package_payments','payments')
      OR tgt.relname IN ('packages','package_payments','payments'))
  ORDER BY parent_table, child_table, con.conname;
`);

console.log(JSON.stringify(out, null, 2));
