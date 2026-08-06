/**
 * census_20260806150000_diagnose.mjs (READ-ONLY)
 * pre-apply census FAIL 후 divergence 성격 진단 — 현재 prod 4함수가 어느 버전인지 마커 판별.
 *   target(20260806150000): 'TOTALS-RECOMPUTE-PORT', 'v_ad_raw', 'daily_closings 확정 구성분'
 *   old(200000 baseline)  : ledger UNION-net, 'supersede', NO 'TOTALS-RECOMPUTE-PORT'
 * author: dev-foot / 2026-08-06
 */
import { query } from './lib/foot_migration_ledger.mjs';
const rows = async (sql) => { const r = await query(sql); return Array.isArray(r) ? r : []; };

const FNS = [
  ['enqueue_closing_confirmed', ''],
  ['closing_source_split', '(uuid,date)'],
  ['closing_insurance_split', '(uuid,date)'],
  ['closing_month_projection', '(uuid,date)'],
];

console.log('════ DIVERGENCE DIAGNOSE (READ-ONLY) ════\n');
for (const [name, sig] of FNS) {
  const q = sig
    ? `SELECT pg_get_functiondef('public.${name}${sig}'::regprocedure) AS def;`
    : `SELECT pg_get_functiondef('public.${name}()'::regprocedure) AS def;`;
  const def = (await rows(q))[0]?.def || '';
  const markers = {
    has_TOTALS_RECOMPUTE_PORT: /TOTALS-RECOMPUTE-PORT/.test(def),
    has_v_ad_raw: /v_ad_raw/.test(def),
    has_v_sys_total: /v_sys_total/.test(def),
    has_daily_closings_authority: /daily_closings 확정 구성분|package_card_total/.test(def),
    has_ledger_union_net: /UNION ALL[\s\S]*closing_source_split|ledger UNION-net|payments net/.test(def),
    has_supersede_fix: /revision\s*<\s*NEW\.revision/.test(def),
    has_stale_actual: /actual_card_total|actual_cash_total|actual_transfer_total/.test(def),
    has_v_hm_or_hm: /health_maintenance|v_hm/.test(def),
    version_tag: (def.match(/v1\.\d/) || [])[0] || null,
    def_len: def.length,
  };
  console.log(`── ${name} ──`);
  console.log(JSON.stringify(markers, null, 2));
  // print the leading comment line if present
  const cmt = (def.match(/IS\s+'([^']{0,180})/) || [])[1];
  if (cmt) console.log(`   COMMENT: ${cmt}...`);
  console.log('');
}

// ledger check: is target migration recorded?
const led = await rows(`SELECT version, name FROM supabase_migrations.schema_migrations
  WHERE version IN ('20260806150000','20260804200000','20260804170000') ORDER BY version;`);
console.log('── LEDGER (schema_migrations) ──');
console.log(JSON.stringify(led, null, 2));
