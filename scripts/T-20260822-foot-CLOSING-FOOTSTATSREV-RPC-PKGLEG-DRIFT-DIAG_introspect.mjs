/**
 * T-20260822-foot-CLOSING-FOOTSTATSREV-RPC-PKGLEG-DRIFT-DIAG — Phase-1 READ-ONLY DIAG
 *   (write0 / DDL0 / introspection only — Management API read-only)
 *
 * 목적: foot_stats_revenue(총매출 KPI RPC) 8월 패키지 leg ~4.82M drift 진단.
 *   AC1) prod pg_proc 실 RPC body ↔ migration 20260719140000 파일선언 ↔ schema_migrations 원장 3자 대조
 *   AC2) 패키지 leg gross/refund 산식 divergence 지점 특정 (RPC pkg vs staffRevenue.ts pkg)
 *   AC3) staffRevenue.ts 헤더 'foot_stats_revenue 정합' 8월 패키지 미성립 원인
 * DB: rxlomoozakkjesdqjtvd (obliv-foot-crm, foot 단일 Supabase). 인증컨텍스트: service (Management API).
 * author: dev-foot / 2026-08-22
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const out = {};

// ── AC1-a) prod live RPC 실 원문 (파일선언 아닌 prod live prosrc) ──────────────
out.rpc_src = await q(`SELECT p.oid::regprocedure sig, p.provolatile, p.prosecdef,
  pg_get_functiondef(p.oid) def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='foot_stats_revenue';`);

// ── AC1-b) schema_migrations 원장 — foot_stats_revenue 관련 마이그 등재 여부 ────
out.ledger = await q(`SELECT version FROM supabase_migrations.schema_migrations
  WHERE version LIKE '20260719%' OR version LIKE '20260715%' OR version LIKE '20260430%'
  ORDER BY version;`).catch(e => ({ error: String(e) }));

// ── AC2-a) package_payments 컬럼 실재 (status/voided_at/deleted_at 있으면 RPC drift 원인 후보) ─
out.pkg_cols = await q(`SELECT column_name, data_type, is_nullable FROM information_schema.columns
  WHERE table_schema='public' AND table_name='package_payments' ORDER BY ordinal_position;`);
out.pkg_checks = await q(`SELECT c.conname, pg_get_constraintdef(c.oid) def FROM pg_constraint c
  JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
  WHERE n.nspname='public' AND t.relname='package_payments' AND c.contype='c';`);

// ── clinic_id 확정 (74967aea prefix) ──────────────────────────────────────────
out.clinics = await q(`SELECT DISTINCT clinic_id FROM package_payments WHERE clinic_id IS NOT NULL;`);
const clinic = (out.clinics.find(c => String(c.clinic_id).startsWith('74967aea')) || out.clinics[0] || {}).clinic_id;
out.clinic_used = clinic;

// ── AC2-b) 8월 패키지 leg: RPC 산식 재현 vs staffRevenue.ts 산식 재현 (라인별 대조) ──
//   RPC pkg   : accounting_date BETWEEN + sim제외(NOT EXISTS). status 필터 없음(선언).
//   staffRev  : accounting_date BETWEEN + sim제외(getSimulationCustomerIds→excludeSim). status 필터 없음.
//   → 둘이 같아야 하는데 실측이 발산 → 어느 술어가 실제 다른지 grain별로 분해.
out.pkg_aug = await q(`
WITH base AS (
  SELECT pp.payment_type, pp.amount, pp.customer_id, c.is_simulation AS cust_sim
  FROM package_payments pp
  LEFT JOIN customers c ON c.id = pp.customer_id
  WHERE pp.clinic_id = '${clinic}'
    AND pp.accounting_date BETWEEN '2026-08-01' AND '2026-08-31'
)
SELECT
  -- (A) RPC 선언 산식 재현: sim제외(NOT EXISTS = cust_sim IS TRUE 인 링크만 제거), status 무필터
  SUM(CASE WHEN payment_type='payment' AND NOT (cust_sim IS TRUE) THEN amount ELSE 0 END) rpc_decl_gross,
  SUM(CASE WHEN payment_type='refund'  AND NOT (cust_sim IS TRUE) THEN amount ELSE 0 END) rpc_decl_refund,
  -- (B) 무필터 전량(구 prod 후보 = sim 미제외)
  SUM(CASE WHEN payment_type='payment' THEN amount ELSE 0 END) raw_gross,
  SUM(CASE WHEN payment_type='refund'  THEN amount ELSE 0 END) raw_refund,
  -- 진단 성분
  COUNT(*) FILTER (WHERE cust_sim IS TRUE) sim_rows,
  SUM(CASE WHEN payment_type='payment' AND cust_sim IS TRUE THEN amount ELSE 0 END) sim_pay,
  SUM(CASE WHEN payment_type='refund'  AND cust_sim IS TRUE THEN amount ELSE 0 END) sim_ref,
  COUNT(*) FILTER (WHERE customer_id IS NULL) walkin_rows,
  SUM(CASE WHEN payment_type='payment' AND customer_id IS NULL THEN amount ELSE 0 END) walkin_pay
FROM base;`);

// ── AC2-c) prod live RPC 를 실제 호출 (deployed body 결과 = 진실) — 8월 ──────────
out.rpc_live_aug = await q(`
SELECT SUM(package_amount) pkg_gross, SUM(single_amount) single_gross, SUM(refund_amount) refund
FROM foot_stats_revenue('${clinic}'::uuid, '2026-08-01'::date, '2026-08-31'::date);`);

// ── AC2-d) package_payments 에 다른 필터축(있을 경우) 존재 여부 진단 — 8월 amount 분포 ──
out.pkg_type_dist = await q(`
SELECT payment_type, COUNT(*) n, SUM(amount) amt
FROM package_payments
WHERE clinic_id='${clinic}' AND accounting_date BETWEEN '2026-08-01' AND '2026-08-31'
GROUP BY payment_type ORDER BY payment_type;`);

// ── AC1-c) axis 무관 확인: created_at KST 축 vs accounting_date 축 8월 pkg (경계 영향?) ──
out.pkg_axis = await q(`
SELECT
  SUM(CASE WHEN accounting_date BETWEEN '2026-08-01' AND '2026-08-31' AND payment_type='payment' THEN amount ELSE 0 END) acct_gross,
  SUM(CASE WHEN (created_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN '2026-08-01' AND '2026-08-31' AND payment_type='payment' THEN amount ELSE 0 END) created_gross
FROM package_payments WHERE clinic_id='${clinic}';`);

console.log(JSON.stringify(out, null, 2));
