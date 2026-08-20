/**
 * T-20260820-foot-CLOSING-SALES-BASIS-FIX — READ-ONLY census
 * 목적(DA CONDITIONAL-GO 병렬 선행): NULL attributed_staff_id 행 census + stamp coverage.
 *   화면①(Closing.tsx staffTotals, LIVE assigned_staff_id)을 canonical staffRevenue.ts 경로(①→②
 *   attributed_staff_id snapshot + NULL live-join fallback belt)로 전환 시, fallback belt 의존량 평가.
 * GATE: READ-ONLY — SELECT/introspection only. prod WRITE/DDL/정정 0. (db_change=false·write0/DDL0)
 * auth: Management API database/query = postgres 슈퍼유저(RLS 미적용) → silent 0-row 회피.
 */
const REF = 'rxlomoozakkjesdqjtvd'; // foot prod
const PAT = process.env.SUPABASE_ACCESS_TOKEN;
if (!PAT) { console.error('FATAL: SUPABASE_ACCESS_TOKEN 없음'); process.exit(1); }
async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }) });
  const out = await res.json().catch(() => null);
  if (res.status !== 200 && res.status !== 201) { console.error(`HTTP ${res.status}`, JSON.stringify(out)); process.exit(1); }
  return out;
}
const j = (x) => JSON.stringify(x, null, 2);

console.log('=== auth-context (postgres/무RLS 여야 함) ===');
console.log(j(await q(`SELECT current_user usr, current_setting('is_superuser') super;`)));

console.log('\n=== 0. attributed_staff_id 컬럼 실재 (payments · package_payments) ===');
console.log(j(await q(`SELECT table_name, column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name IN ('payments','package_payments')
    AND column_name IN ('attributed_staff_id','customer_id','accounting_date','status')
  ORDER BY table_name, column_name;`)));

// ── payments: 전체 / attributed NULL / NULL 중 live-join fallback 해소 가능 / STAFF_UNASSIGNED 잔존 ──
const payCensus = (label, whereExtra) => `
  SELECT '${label}' AS scope,
    count(*) AS total_rows,
    count(*) FILTER (WHERE p.attributed_staff_id IS NOT NULL) AS attr_stamped,
    count(*) FILTER (WHERE p.attributed_staff_id IS NULL) AS attr_null,
    count(*) FILTER (WHERE p.attributed_staff_id IS NULL AND c.assigned_staff_id IS NOT NULL) AS null_but_livejoin_resolves,
    count(*) FILTER (WHERE p.attributed_staff_id IS NULL AND (p.customer_id IS NULL OR c.assigned_staff_id IS NULL)) AS null_falls_to_unassigned
  FROM public.payments p
  LEFT JOIN public.customers c ON c.id = p.customer_id
  WHERE p.status NOT IN ('cancelled','deleted') ${whereExtra}`;

console.log('\n=== 1a. payments — 전체(all-time) attributed stamp coverage ===');
console.log(j(await q(payCensus('payments·all-time', ''))));

console.log('\n=== 1b. payments — 최근 90일(accounting_date) coverage ===');
console.log(j(await q(payCensus('payments·90d', `AND p.accounting_date >= (CURRENT_DATE - INTERVAL '90 days')`))));

console.log('\n=== 1c. payments — 관측 표본일(08-18 / 08-20) coverage ===');
console.log(j(await q(payCensus('payments·0818_0820', `AND p.accounting_date IN ('2026-08-18','2026-08-20')`))));

// ── package_payments (status 컬럼 부재 → 필터 없음) ──
const pkgCensus = (label, whereExtra) => `
  SELECT '${label}' AS scope,
    count(*) AS total_rows,
    count(*) FILTER (WHERE pp.attributed_staff_id IS NOT NULL) AS attr_stamped,
    count(*) FILTER (WHERE pp.attributed_staff_id IS NULL) AS attr_null,
    count(*) FILTER (WHERE pp.attributed_staff_id IS NULL AND c.assigned_staff_id IS NOT NULL) AS null_but_livejoin_resolves,
    count(*) FILTER (WHERE pp.attributed_staff_id IS NULL AND (pp.customer_id IS NULL OR c.assigned_staff_id IS NULL)) AS null_falls_to_unassigned
  FROM public.package_payments pp
  LEFT JOIN public.customers c ON c.id = pp.customer_id
  WHERE 1=1 ${whereExtra}`;

console.log('\n=== 2a. package_payments — 전체(all-time) attributed stamp coverage ===');
console.log(j(await q(pkgCensus('package_payments·all-time', ''))));

console.log('\n=== 2b. package_payments — 최근 90일(accounting_date) coverage ===');
console.log(j(await q(pkgCensus('package_payments·90d', `AND pp.accounting_date >= (CURRENT_DATE - INTERVAL '90 days')`))));

console.log('\n=== 2c. package_payments — 관측 표본일(08-18 / 08-20) coverage ===');
console.log(j(await q(pkgCensus('package_payments·0818_0820', `AND pp.accounting_date IN ('2026-08-18','2026-08-20')`))));

// ── 재배정 divergence 위험: attributed_staff_id != 현재 assigned_staff_id 인 행 (①→② 전환 시 화면① 숫자가 바뀌는 유일 케이스) ──
console.log('\n=== 3. 재배정 divergence — attributed_staff_id <> live assigned_staff_id (전환 시 화면①이 바뀌는 셀·최근 90일) ===');
console.log(j(await q(`
  SELECT 'payments' src,
    count(*) FILTER (WHERE p.attributed_staff_id IS NOT NULL AND c.assigned_staff_id IS NOT NULL
                       AND p.attributed_staff_id <> c.assigned_staff_id) AS divergent_rows,
    coalesce(sum(CASE WHEN p.payment_type='refund' THEN -p.amount ELSE p.amount END)
             FILTER (WHERE p.attributed_staff_id IS NOT NULL AND c.assigned_staff_id IS NOT NULL
                       AND p.attributed_staff_id <> c.assigned_staff_id),0) AS divergent_net
  FROM public.payments p LEFT JOIN public.customers c ON c.id = p.customer_id
  WHERE p.status NOT IN ('cancelled','deleted') AND p.accounting_date >= (CURRENT_DATE - INTERVAL '90 days')
  UNION ALL
  SELECT 'package_payments' src,
    count(*) FILTER (WHERE pp.attributed_staff_id IS NOT NULL AND c.assigned_staff_id IS NOT NULL
                       AND pp.attributed_staff_id <> c.assigned_staff_id) AS divergent_rows,
    coalesce(sum(CASE WHEN pp.payment_type='refund' THEN -pp.amount ELSE pp.amount END)
             FILTER (WHERE pp.attributed_staff_id IS NOT NULL AND c.assigned_staff_id IS NOT NULL
                       AND pp.attributed_staff_id <> c.assigned_staff_id),0) AS divergent_net
  FROM public.package_payments pp LEFT JOIN public.customers c ON c.id = pp.customer_id
  WHERE pp.accounting_date >= (CURRENT_DATE - INTERVAL '90 days');`)));

console.log('\n=== CENSUS DONE (READ-ONLY · no write/DDL) ===');
