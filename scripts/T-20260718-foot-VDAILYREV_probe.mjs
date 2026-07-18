/**
 * T-20260718-foot-VDAILYREV-UNFILTERED-XCRM-APPLY — READ-ONLY prod 실컬럼/뷰상태 재확인 (AC4 의무).
 * payments/package_payments 실컬럼 + v_daily_revenue viewdef/reloptions/anon-grant + AC-B before 스냅샷.
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
// 1) payments 실컬럼 (status/is_simulation/payment_scope/refund_date 존재여부)
out.payments_cols = await q(`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='payments'
  ORDER BY ordinal_position;`);
// 2) package_payments 실컬럼
out.pkg_cols = await q(`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='package_payments'
  ORDER BY ordinal_position;`);
// 3) payments.status CHECK 제약 값
out.status_check = await q(`
  SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
  WHERE conrelid='public.payments'::regclass AND contype='c'
    AND pg_get_constraintdef(oid) ILIKE '%status%';`);
// 4) 현재 v_daily_revenue viewdef
out.viewdef = await q(`SELECT pg_get_viewdef('public.v_daily_revenue'::regclass, true) AS def;`);
// 5) reloptions (security_invoker)
out.reloptions = await q(`
  SELECT reloptions FROM pg_class WHERE oid='public.v_daily_revenue'::regclass;`);
// 6) anon grants on view
out.anon_grants = await q(`
  SELECT grantee, privilege_type FROM information_schema.role_table_grants
  WHERE table_schema='public' AND table_name='v_daily_revenue'
  ORDER BY grantee, privilege_type;`);
// 7) AC-B BEFORE 스냅샷: 현재 뷰 net_revenue by dt (최근 14일) + cancelled/deleted 부풀림 크기
out.before_view = await q(`
  SELECT dt, clinic_id, single_revenue, package_revenue, net_revenue
  FROM v_daily_revenue WHERE dt >= (now() AT TIME ZONE 'Asia/Seoul')::date - 14
  ORDER BY dt DESC, clinic_id;`);
// 8) status 분포 (부풀림 기여도 = cancelled/deleted 결제 합)
out.status_dist = await q(`
  SELECT status, count(*) AS n, sum(amount) AS sum_amount
  FROM payments GROUP BY status ORDER BY status;`);
// 9) status=active 필터 적용 시 예상 net_revenue (최근 14일) — 사전 대조
out.after_expect = await q(`
  WITH single AS (
    SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date AS dt, clinic_id,
      SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END)::bigint AS amt
    FROM payments WHERE clinic_id IS NOT NULL AND status='active' GROUP BY 1,2
  ), pkg AS (
    SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date AS dt, clinic_id,
      SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END)::bigint AS amt
    FROM package_payments WHERE clinic_id IS NOT NULL GROUP BY 1,2
  )
  SELECT COALESCE(s.dt,p.dt) AS dt, COALESCE(s.clinic_id,p.clinic_id) AS clinic_id,
    COALESCE(s.amt,0)+COALESCE(p.amt,0) AS net_revenue
  FROM single s FULL OUTER JOIN pkg p ON p.dt=s.dt AND p.clinic_id=s.clinic_id
  WHERE COALESCE(s.dt,p.dt) >= (now() AT TIME ZONE 'Asia/Seoul')::date - 14
  ORDER BY dt DESC, clinic_id;`);
console.log(JSON.stringify(out, null, 2));
