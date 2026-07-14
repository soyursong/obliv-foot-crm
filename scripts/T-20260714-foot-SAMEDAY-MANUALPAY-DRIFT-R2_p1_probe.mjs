/**
 * T-20260714-foot-SAMEDAY-MANUALPAY-DRIFT-R2-REMAP-CLEAN — Phase 1 READ-ONLY 조회/대사.
 * 목적: R1(SAMEDAY-REMAP) apply(12행 canonical) 이후 잔여 당일 수기수납(drift/신규)을 재조회·분류.
 *   대상셋 = 당일(2026-07-14) 전체 closing_manual_payments − R1 canonical 마커 12행.
 *   (R1은 정본화한 12행을 closing_manual_payments에서 DELETE → 현재 잔존행 = R2 대상셋)
 * SELECT only. write 0.
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const out = {};

// (1) R2 대상셋 = 현재 잔존 당일 수기수납 (R1이 12행 DELETE 후 남은 것)
out.cmp_remaining = await q(`
  SELECT id, pay_time, chart_number, customer_name, amount, method, staff_name, memo, created_at
  FROM closing_manual_payments
  WHERE clinic_id='${CLINIC}' AND close_date='2026-07-14'
  ORDER BY created_at;
`);

// (2) R1 canonical 마커 재확인 (double-canonicalize 방지: 12행 존재/무접촉 확인)
out.r1_canonical_pp = await q(`
  SELECT count(*)::int AS n, COALESCE(SUM(amount),0)::bigint AS sum FROM package_payments
  WHERE memo LIKE '%T-20260714-SAMEDAY-REMAP%';`);
out.r1_canonical_pay = await q(`
  SELECT count(*)::int AS n, COALESCE(SUM(amount),0)::bigint AS sum FROM payments
  WHERE memo LIKE '%T-20260714-SAMEDAY-REMAP%';`);
// R2 자체 마커 사전존재 여부 (아직 0이어야 함)
out.r2_canonical_pre = await q(`
  SELECT 'pp' AS t, count(*)::int AS n FROM package_payments WHERE memo LIKE '%DRIFT-R2%'
  UNION ALL SELECT 'pay', count(*)::int FROM payments WHERE memo LIKE '%DRIFT-R2%';`);

// (3) customers 컬럼 확인 (chart_number 링크 방법)
out.cust_cols = await q(`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='customers' ORDER BY ordinal_position;`);
out.pkg_cols = await q(`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='packages' ORDER BY ordinal_position;`);

console.log(JSON.stringify(out, null, 2));
