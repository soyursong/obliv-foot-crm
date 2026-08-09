/**
 * T-20260810-foot-ARCHE-PORPHAN-CORRECTION — Q5 forward-seal FORENSIC probe (READ-ONLY, SELECT-only).
 *   (1) code-pin  : live prod function consume_package_sessions_for_checkin — 5-arg marking version live?
 *                   (§0-2 source-closed: is_package_session=true 경로에서 package_session_id 강제 write live)
 *   (2) forensic  : guard-live(2026-07-23 ~19:12 KST = 10:12 UTC) 이후 신규 P-orphan
 *                   (is_package_session=true ∩ package_session_id IS NULL) 생성 = 0 시계열 실측.
 * prod write/DDL 0. 정정/apply/forward re-wire 착수 0.
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('/Users/domas/GitHub/obliv-foot-crm/.env.local','utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim();
const REF='rxlomoozakkjesdqjtvd';
if(!tok){console.error('no token');process.exit(1);}
async function q(sql){
  const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{
    method:'POST',headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql})});
  const t=await r.text(); if(!r.ok) throw new Error(`HTTP ${r.status}: ${t}`); return JSON.parse(t);
}
const out={};

// ── (1a) code-pin: live function signatures + does prosrc contain the marking UPDATE? ──
out.live_function_defs = await q(`
  SELECT p.oid::regprocedure::text AS signature,
         pg_get_function_arguments(p.oid) AS args,
         (position('package_session_id = v_session_id' in pg_get_functiondef(p.oid)) > 0) AS has_fk_forward_write,
         (position('is_package_session = true' in pg_get_functiondef(p.oid)) > 0)          AS has_flag_set,
         (position('p_service_sessions' in pg_get_functiondef(p.oid)) > 0)                 AS has_service_sessions_param,
         md5(pg_get_functiondef(p.oid)) AS def_md5
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE p.proname='consume_package_sessions_for_checkin'
  ORDER BY 1;
`);

// ── (1b) code-pin: is the marking UPDATE a single-signature (no stale 4-arg overload)? ──
out.function_overload_count = await q(`
  SELECT COUNT(*) AS n_signatures
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE p.proname='consume_package_sessions_for_checkin' AND n.nspname='public';
`);

// ── (1c) code-pin: schema_migrations ledger records the guard migration ──
out.migration_ledger = await q(`
  SELECT version, name, executed_at
  FROM supabase_migrations.schema_migrations
  WHERE version LIKE '20260723190000%' OR name ILIKE '%pkgsession_link_unwired%'
  ORDER BY version;
`).catch(e=>({error:String(e)}));

// ── (2a) forensic: current P-orphan population (is_pkg=true ∩ sid IS NULL) — still 62? ──
out.current_porphan_count = await q(`
  SELECT
    COUNT(*) FILTER (WHERE is_package_session = true AND package_session_id IS NULL)     AS p_orphan_now,
    COUNT(*) FILTER (WHERE is_package_session = true AND package_session_id IS NOT NULL) AS healthy_linked,
    COUNT(*) FILTER (WHERE is_package_session = true)                                    AS flag_true_total
  FROM check_in_services;
`);

// ── (2b) forensic: P-orphan created_at distribution vs guard-live (10:12 UTC 2026-07-23) ──
//   guard-live 이후 생성된 P-orphan 이 있으면 = 상처(H2). before-only = seal(H1).
out.porphan_vs_guardlive = await q(`
  WITH po AS (
    SELECT id, created_at
    FROM check_in_services
    WHERE is_package_session = true AND package_session_id IS NULL
  )
  SELECT
    COUNT(*) AS total,
    MIN(created_at) AS earliest,
    MAX(created_at) AS latest,
    COUNT(*) FILTER (WHERE created_at <  TIMESTAMPTZ '2026-07-23 10:12:00+00') AS before_guard_1912kst,
    COUNT(*) FILTER (WHERE created_at >= TIMESTAMPTZ '2026-07-23 10:12:00+00') AS on_or_after_guard_1912kst,
    COUNT(*) FILTER (WHERE created_at >= TIMESTAMPTZ '2026-07-24 00:00:00+09') AS after_census_0724kst,
    COUNT(*) FILTER (WHERE created_at >= TIMESTAMPTZ '2026-07-23 15:00:00+00') AS after_guard_midnight_conservative
  FROM po;
`);

// ── (2c) forensic: P-orphan created_at by day (full time-series, transparency) ──
out.porphan_by_day = await q(`
  SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date AS day_kst, COUNT(*) AS n
  FROM check_in_services
  WHERE is_package_session = true AND package_session_id IS NULL
  GROUP BY 1 ORDER BY 1;
`);

// ── (2d) forensic: newest is_package_session=true rows overall — did the guard start linking new consumption? ──
//   guard-live 후 신규 소비는 healthy(sid NOT NULL)로 착지해야 정상. 최근 flag_true 행의 링크 상태 확인.
out.recent_flag_true_link_state = await q(`
  SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date AS day_kst,
         COUNT(*)                                              AS flag_true_n,
         COUNT(*) FILTER (WHERE package_session_id IS NOT NULL) AS linked_n,
         COUNT(*) FILTER (WHERE package_session_id IS NULL)     AS orphan_n
  FROM check_in_services
  WHERE is_package_session = true
    AND created_at >= TIMESTAMPTZ '2026-07-23 10:12:00+00'
  GROUP BY 1 ORDER BY 1;
`);

// ── (2e) forensic: healthy links created post-guard (proof the chokepoint is actively wiring) ──
out.healthy_created_post_guard = await q(`
  SELECT COUNT(*) AS healthy_linked_post_guard,
         MIN(created_at) AS earliest_post_guard_healthy,
         MAX(created_at) AS latest_post_guard_healthy
  FROM check_in_services
  WHERE is_package_session = true AND package_session_id IS NOT NULL
    AND created_at >= TIMESTAMPTZ '2026-07-23 10:12:00+00';
`);

console.log(JSON.stringify(out,null,2));
