/**
 * T-20260813-foot-STATS-REVENUE-ISTEST-FILTER-4SURFACE — STEP1 LIVE prod introspect (READ-ONLY)
 *
 * 목적: 4 surface 의 LIVE prod 실정의를 조회해
 *   (a) is_test / is_simulation 필터 유무
 *   (b) customers join 축 존재/경로
 *   (c) 워크인(customer_id NULL) 처리
 * 를 추측 없이 ground-truth 로 확정.
 *
 * 대상:
 *   1. foot_stats_revenue (RPC)          — pg_get_functiondef
 *   2. v_daily_avg_spend (VIEW)          — pg_get_viewdef
 *   3. v_monthly_therapist_perf (VIEW)   — pg_get_viewdef
 *   4. v_monthly_consultant_perf (VIEW)  — pg_get_viewdef
 *
 * READ-ONLY: SELECT/카탈로그 조회만. prod write 0.
 * 실행: Supabase Management API (/database/query).
 */
const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
  || (() => { throw new Error('SUPABASE_ACCESS_TOKEN env required'); })();

async function sql(query) {
  const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query }),
  });
  const body = await resp.json();
  if (!resp.ok) { console.error('SQL ERROR', resp.status, JSON.stringify(body)); throw new Error('SQL failed'); }
  return body;
}
const line = (s = '') => console.log(s);
const H = (s) => { line(); line('━'.repeat(64)); line(s); line('━'.repeat(64)); };

line(`# STEP1 introspect (READ-ONLY)  ${new Date().toISOString()}`);

// ── 0. customers.is_test / is_simulation 컬럼 실재 ──
H('0. customers is_test / is_simulation 컬럼 실재');
const ccols = await sql(`
  SELECT column_name, data_type, column_default, is_nullable
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='customers'
    AND column_name IN ('is_test','is_simulation','id')
  ORDER BY column_name`);
console.log(JSON.stringify(ccols, null, 2));

// ── 1. foot_stats_revenue RPC 정의 ──
H('1. foot_stats_revenue (RPC) — pg_get_functiondef');
const fn = await sql(`
  SELECT p.oid::regprocedure AS sig, pg_get_functiondef(p.oid) AS def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='foot_stats_revenue'`);
if (!fn.length) { line('  ⚠ foot_stats_revenue 함수 없음'); }
for (const r of fn) { line(`  -- SIG: ${r.sig}`); line(r.def); line(); }

// ── 2~4. VIEW 정의 ──
for (const v of ['v_daily_avg_spend','v_monthly_therapist_perf','v_monthly_consultant_perf']) {
  H(`VIEW ${v} — pg_get_viewdef`);
  const exists = await sql(`SELECT to_regclass('public.${v}') AS oid`);
  if (!exists[0].oid) { line(`  ⚠ ${v} 없음`); continue; }
  const def = await sql(`SELECT pg_get_viewdef('public.${v}'::regclass, true) AS def`);
  line(def[0].def);
  // reloptions (security_invoker 등)
  const rel = await sql(`SELECT reloptions FROM pg_class WHERE oid='public.${v}'::regclass`);
  line(`  -- reloptions: ${JSON.stringify(rel[0].reloptions)}`);
}

line();
line('# STEP1 introspect done.');
