/**
 * T-20260813-foot-STATS-REVENUE-ISTEST-FILTER-4SURFACE — STEP3 delta verify (READ-ONLY)
 *
 * 목적: 4 surface 각각, is_test(+is_simulation) 필터 전/후 매출 델타를 고객-클래스별로 분해해
 *   (1) pre-0713 test set(=부모 215 백필 대상+3 already; 부모 apply 後 is_test=true) 매출만 감소
 *   (2) 워크인(customer_id NULL) 매출 0 감소
 *   (3) 실고객(post-0713·비-test·비-sim) 매출 0 감소
 *   (4) is_simulation marginal(post-0713·非test) 매출 = 별도 계상(canonical mirror 안전벨트)
 * 를 assert.
 *
 * ★부모(215 백필) prod apply 前 실행 → is_test=true 실재 5건뿐.
 *   따라서 "부모 apply 後 예상 델타" 는 pre-0713 predicate(created_at<2026-07-13 KST)를
 *   is_test 프록시로 사용해 산출(= 부모가 is_test=true 로 만들 대상집합).
 *
 * READ-ONLY: SELECT 만. prod write 0.
 */
const R = 'rxlomoozakkjesdqjtvd';
const T = process.env.SUPABASE_ACCESS_TOKEN || (() => { throw new Error('SUPABASE_ACCESS_TOKEN required'); })();
const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${R}/database/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${T}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b));
  return b;
};
const KST = "'2026-07-13 00:00:00+09'";
const PRE = `cu.created_at < ${KST}`;                       // pre-0713 test proxy (= 부모 is_test 대상)
const line = (s = '') => console.log(s);
const H = (s) => { line(); line('━'.repeat(60)); line(s); line('━'.repeat(60)); };
line(`# STEP3 delta verify (READ-ONLY)  ${new Date().toISOString()}`);

// signed net expression helper
const NET = (t) => `SUM(CASE WHEN ${t}.payment_type='refund' THEN -${t}.amount ELSE ${t}.amount END)`;

// ── A) payments / package_payments 직결 surface (RPC #1, v_daily_avg_spend #2) ──
for (const tbl of ['payments', 'package_payments']) {
  H(`money table: ${tbl}`);
  // RPC uses status filter for payments; avg_spend view does NOT. report both raw sets.
  const statusFilt = tbl === 'payments' ? `AND ${tbl}.status NOT IN ('cancelled','deleted')` : '';
  const q = `
    SELECT
      COUNT(*)                                                        AS rows_all,
      COALESCE(${NET(tbl)},0)                                         AS net_all,
      COALESCE(${NET(tbl)} FILTER (WHERE cu.id IS NULL),0)            AS net_walkin,
      COUNT(*)          FILTER (WHERE cu.id IS NULL)                  AS rows_walkin,
      COALESCE(${NET(tbl)} FILTER (WHERE ${PRE}),0)                   AS net_pre0713_test,
      COUNT(*)          FILTER (WHERE ${PRE})                         AS rows_pre0713_test,
      COALESCE(${NET(tbl)} FILTER (WHERE COALESCE(cu.is_simulation,false)),0) AS net_sim,
      COALESCE(${NET(tbl)} FILTER (WHERE COALESCE(cu.is_simulation,false) AND NOT (${PRE}) AND NOT COALESCE(cu.is_test,false)),0) AS net_sim_marginal,
      COALESCE(${NET(tbl)} FILTER (WHERE cu.id IS NOT NULL AND NOT (${PRE}) AND NOT COALESCE(cu.is_test,false) AND NOT COALESCE(cu.is_simulation,false)),0) AS net_real_kept
    FROM ${tbl}
    LEFT JOIN customers cu ON cu.id = ${tbl}.customer_id
    WHERE ${tbl}.clinic_id IS NOT NULL ${statusFilt}`;
  const res = (await sql(q))[0];
  line(JSON.stringify(res, null, 2));
}

// ── B) check_ins-grain surface (#3 therapist, #4 consultant) ──
// revenue = payments joined via check_in_id; test-filter on check_ins.customer_id
H('check_ins-grain revenue (therapist/consultant surfaces #3 #4)');
const q2 = `
  WITH ci_done AS (
    SELECT ci.id, ci.customer_id, cu.id AS cust, cu.created_at AS c_created,
           COALESCE(cu.is_test,false) AS is_test, COALESCE(cu.is_simulation,false) AS is_sim
    FROM check_ins ci
    LEFT JOIN customers cu ON cu.id = ci.customer_id
    WHERE ci.status='done'
  ),
  rev AS (
    SELECT ci_done.*,
      COALESCE((SELECT SUM(CASE WHEN p.payment_type='refund' THEN -p.amount ELSE p.amount END)
                FROM payments p WHERE p.check_in_id = ci_done.id),0) AS net
    FROM ci_done
  )
  SELECT
    COUNT(*)                                            AS ci_all,
    COALESCE(SUM(net),0)                                AS net_all,
    COALESCE(SUM(net) FILTER (WHERE cust IS NULL),0)    AS net_walkin,
    COUNT(*)  FILTER (WHERE cust IS NULL)               AS ci_walkin,
    COALESCE(SUM(net) FILTER (WHERE c_created < ${KST}),0) AS net_pre0713_test,
    COUNT(*)  FILTER (WHERE c_created < ${KST})         AS ci_pre0713_test,
    COALESCE(SUM(net) FILTER (WHERE is_sim),0)          AS net_sim,
    COALESCE(SUM(net) FILTER (WHERE is_sim AND NOT (c_created < ${KST}) AND NOT is_test),0) AS net_sim_marginal,
    COALESCE(SUM(net) FILTER (WHERE cust IS NOT NULL AND NOT (c_created < ${KST}) AND NOT is_test AND NOT is_sim),0) AS net_real_kept
  FROM rev`;
line(JSON.stringify((await sql(q2))[0], null, 2));

line();
line('# STEP3 delta verify done.');
