/**
 * T-20260717-foot-DAYCLOSE-VS-SIDEBAR-MGRSTAT-RECONCILE — DRY-RUN (READ-ONLY)
 *
 * ⚠ SELECT/시뮬레이션만. write/DDL 0. prod foot_stats_consultant 미변경(non-persistence).
 *   NEW 로직을 inline SELECT 로 실행(함수 미생성) → AC4 대사 불변식 재현대조:
 *     Σ(상담사 total_amount) + 미귀속_잔차 = foot_stats_revenue 기간 net (원단위).
 *   잔차 material(>1% or >10만) → flag.  BINDING-3: 강제귀속 금지, 계측만.
 *   비교: 구 RPC(현 prod) vs NEW 값 → 실장별 총매출 <1%→~100% 점프 확인.
 *
 * 실행: node supabase/migrations/20260717160000_foot_stats_consultant_pkg_attr_reconstruct.dryrun.mjs
 */
import { readFileSync } from 'node:fs';
const ENV = '/Users/domas/GitHub/obliv-foot-crm/.env.local';
const env = Object.fromEntries(
  readFileSync(ENV, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const TOK = env.SUPABASE_ACCESS_TOKEN;
const REF = 'rxlomoozakkjesdqjtvd';
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // 오블리브의원 서울오리진점 (foot active)
const won = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR'));

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

// NEW 로직 = 마이그 본문과 동일한 CTE. 함수 미생성, inline SELECT 로만 실행(무영속).
const NEW_SQL = (from, to) => `
  WITH
  ticketed AS (
    SELECT DISTINCT ci.id AS check_in_id, ci.consultant_id
    FROM check_ins ci JOIN status_transitions st ON st.check_in_id = ci.id
    WHERE ci.clinic_id = '${CLINIC}' AND ci.consultant_id IS NOT NULL
      AND (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN '${from}' AND '${to}'
      AND st.to_status = 'consultation'
  ),
  ticketed_all AS (
    SELECT DISTINCT ci.id AS check_in_id, ci.consultant_id, ci.customer_id, ci.checked_in_at
    FROM check_ins ci JOIN status_transitions st ON st.check_in_id = ci.id
    WHERE ci.clinic_id = '${CLINIC}' AND ci.consultant_id IS NOT NULL AND st.to_status = 'consultation'
  ),
  pkg_attr AS (
    SELECT DISTINCT ON (p.id) p.id AS package_id, ta.consultant_id
    FROM packages p JOIN ticketed_all ta ON ta.customer_id = p.customer_id
    WHERE p.clinic_id = '${CLINIC}'
    ORDER BY p.id, (ta.checked_in_at <= p.created_at) DESC,
      ABS(EXTRACT(EPOCH FROM (p.created_at - ta.checked_in_at))) ASC, ta.check_in_id
  ),
  pkg_rev AS (
    SELECT pa.consultant_id,
      SUM(CASE WHEN pp.payment_type='refund' THEN -pp.amount ELSE pp.amount END)::bigint AS rev
    FROM package_payments pp JOIN pkg_attr pa ON pa.package_id = pp.package_id
    WHERE pp.clinic_id = '${CLINIC}' AND pp.accounting_date BETWEEN '${from}' AND '${to}'
    GROUP BY pa.consultant_id
  ),
  pkg_conv AS (
    SELECT pa.consultant_id, COUNT(DISTINCT pp.package_id)::int AS package_count
    FROM package_payments pp JOIN pkg_attr pa ON pa.package_id = pp.package_id
    WHERE pp.clinic_id = '${CLINIC}' AND pp.accounting_date BETWEEN '${from}' AND '${to}'
      AND pp.payment_type = 'payment'
    GROUP BY pa.consultant_id
  ),
  single_rev AS (
    SELECT ta.consultant_id,
      SUM(CASE WHEN pay.payment_type='refund' THEN -pay.amount ELSE pay.amount END)::bigint AS rev
    FROM payments pay JOIN ticketed_all ta ON ta.check_in_id = pay.check_in_id
    WHERE pay.clinic_id = '${CLINIC}' AND pay.accounting_date BETWEEN '${from}' AND '${to}'
    GROUP BY ta.consultant_id
  ),
  tk_count AS (
    SELECT t.consultant_id, COUNT(DISTINCT t.check_in_id)::int AS ticketing_count
    FROM ticketed t GROUP BY t.consultant_id
  ),
  consultant_universe AS (
    SELECT consultant_id FROM tk_count
    UNION SELECT consultant_id FROM pkg_rev
    UNION SELECT consultant_id FROM single_rev
  )
  SELECT s.id AS consultant_id, s.name,
    COALESCE(tk.ticketing_count,0) AS ticketing_count,
    COALESCE(pc.package_count,0)   AS package_count,
    CASE WHEN COALESCE(tk.ticketing_count,0)>0
      THEN ROUND((COALESCE(pr.rev,0)+COALESCE(sr.rev,0))::numeric / tk.ticketing_count)::bigint ELSE 0 END AS avg_amount,
    (COALESCE(pr.rev,0)+COALESCE(sr.rev,0))::bigint AS total_amount
  FROM staff s
  JOIN consultant_universe cu ON cu.consultant_id = s.id
  LEFT JOIN tk_count tk ON tk.consultant_id = s.id
  LEFT JOIN pkg_rev pr ON pr.consultant_id = s.id
  LEFT JOIN pkg_conv pc ON pc.consultant_id = s.id
  LEFT JOIN single_rev sr ON sr.consultant_id = s.id
  WHERE s.clinic_id = '${CLINIC}' AND s.role = 'consultant'
  GROUP BY s.id, s.name, tk.ticketing_count, pc.package_count, pr.rev, sr.rev
  ORDER BY ticketing_count DESC, avg_amount DESC;
`;

// View A net (foot_stats_revenue) = package+single payment − refund, accounting_date 윈도잉.
const VIEWA_SQL = (from, to) => `
  SELECT COALESCE(SUM(package_amount + single_amount - refund_amount),0)::bigint AS net_a
  FROM foot_stats_revenue('${CLINIC}', '${from}', '${to}');
`;

// 미귀속 잔차: 기간 payments net + 기간 package_payments net (전액, 귀속무관) − Σ(귀속 net).
// = View A net − Σ(total). BINDING-3: 강제귀속 금지, 계측만. 귀속불가 = 전기간 ticketed 상담이력 전무.
const RESIDUAL_DETAIL_SQL = (from, to) => `
  WITH
  ticketed_all AS (
    SELECT DISTINCT ci.customer_id, ci.id AS check_in_id
    FROM check_ins ci JOIN status_transitions st ON st.check_in_id = ci.id
    WHERE ci.clinic_id = '${CLINIC}' AND ci.consultant_id IS NOT NULL AND st.to_status='consultation'
  ),
  -- 귀속불가 패키지매출: 고객이 전기간 ticketed 상담이력 전무
  pkg_unattr AS (
    SELECT pp.package_id, pp.amount, pp.payment_type
    FROM package_payments pp
    JOIN packages p ON p.id = pp.package_id
    WHERE pp.clinic_id='${CLINIC}' AND pp.accounting_date BETWEEN '${from}' AND '${to}'
      AND NOT EXISTS (SELECT 1 FROM ticketed_all ta WHERE ta.customer_id = p.customer_id)
  ),
  -- 귀속불가 단건매출: payment 의 check_in 이 ticketed 아님(consultant 상담 아님)
  single_unattr AS (
    SELECT pay.id, pay.amount, pay.payment_type
    FROM payments pay
    WHERE pay.clinic_id='${CLINIC}' AND pay.accounting_date BETWEEN '${from}' AND '${to}'
      AND NOT EXISTS (SELECT 1 FROM ticketed_all ta WHERE ta.check_in_id = pay.check_in_id)
  )
  SELECT
    (SELECT COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0)::bigint FROM pkg_unattr)    AS pkg_residual_net,
    (SELECT COUNT(*) FROM pkg_unattr)                                                                                  AS pkg_residual_cnt,
    (SELECT COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0)::bigint FROM single_unattr) AS single_residual_net,
    (SELECT COUNT(*) FROM single_unattr)                                                                              AS single_residual_cnt;
`;

const PERIODS = [
  ['2026-05-01', '2026-05-31', '2026-05 (월)'],
  ['2026-06-01', '2026-06-30', '2026-06 (월)'],
  ['2026-07-01', '2026-07-31', '2026-07 (월)'],
  ['2026-07-14', '2026-07-14', '2026-07-14 (일)'],
  ['2026-07-15', '2026-07-15', '2026-07-15 (일)'],
  ['2026-07-16', '2026-07-16', '2026-07-16 (일)'],
];

console.log('════════════════════════════════════════════════════════════════');
console.log(' DRY-RUN: foot_stats_consultant 시간정렬 재구성 (권고안 A) — AC4 대사');
console.log(' clinic:', CLINIC, '(오블리브의원 서울오리진점)');
console.log('════════════════════════════════════════════════════════════════');

// non-persistence pre-probe
const preHash = await q(`SELECT md5(pg_get_functiondef(p.oid)) AS h FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='foot_stats_consultant';`);
console.log('\n[pre-probe] prod foot_stats_consultant prosrc md5 =', preHash[0]?.h);

let anyFlag = false;
for (const [from, to, label] of PERIODS) {
  const rowsNew = await q(NEW_SQL(from, to));
  const rowsOld = await q(`SELECT * FROM foot_stats_consultant('${CLINIC}','${from}','${to}') ORDER BY ticketing_count DESC;`);
  const viewA = await q(VIEWA_SQL(from, to));
  const resid = await q(RESIDUAL_DETAIL_SQL(from, to));

  const sumNew = rowsNew.reduce((a, r) => a + Number(r.total_amount), 0);
  const sumOld = rowsOld.reduce((a, r) => a + Number(r.total_amount), 0);
  const netA = Number(viewA[0].net_a);
  const rd = resid[0];
  const residNet = Number(rd.pkg_residual_net) + Number(rd.single_residual_net);
  const residCnt = Number(rd.pkg_residual_cnt) + Number(rd.single_residual_cnt);
  const lhs = sumNew + residNet;                 // Σ(상담사) + 잔차
  const diff = lhs - netA;                        // AC4: == 0 이어야 함
  const residPct = netA !== 0 ? (residNet / netA * 100) : 0;
  const materialFlag = Math.abs(residNet) > 100000 || Math.abs(residPct) > 1;

  console.log(`\n──── ${label}  [${from} ~ ${to}] ────`);
  console.log(`  View A (foot_stats_revenue) net        : ${won(netA)}`);
  console.log(`  Σ(NEW 상담사 total_amount)             : ${won(sumNew)}  (구 RPC Σ: ${won(sumOld)})`);
  console.log(`  미귀속 잔차 net / 건수                 : ${won(residNet)} / ${residCnt}건  (pkg ${won(rd.pkg_residual_net)}/${rd.pkg_residual_cnt} · single ${won(rd.single_residual_net)}/${rd.single_residual_cnt})`);
  console.log(`  잔차 비율                              : ${residPct.toFixed(2)}%  ${materialFlag ? '⚠ MATERIAL(>1% or >10만) → flag' : 'OK'}`);
  console.log(`  AC4 대사: Σ + 잔차 (${won(lhs)}) − View A (${won(netA)}) = ${won(diff)}  ${diff === 0 ? '✅ 불변식 성립' : '❌ DIVERGENCE'}`);
  console.log(`  구→신 점프: Σ ${won(sumOld)} → ${won(sumNew)} (${sumOld ? '+' + Math.round((sumNew - sumOld) / Math.max(sumOld, 1) * 100) + '%' : 'n/a'})`);
  if (rowsNew.length) {
    console.log('  NEW 상담사별:');
    for (const r of rowsNew) console.log(`    - ${r.name}: 티켓 ${r.ticketing_count} / 전환 ${r.package_count} / 객단가 ${won(r.avg_amount)} / 총매출 ${won(r.total_amount)}`);
  }
  if (materialFlag) anyFlag = true;
  if (diff !== 0) anyFlag = true;
}

// non-persistence post-probe
const postHash = await q(`SELECT md5(pg_get_functiondef(p.oid)) AS h FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='foot_stats_consultant';`);
console.log('\n[post-probe] prod foot_stats_consultant prosrc md5 =', postHash[0]?.h);
console.log('[non-persistence]', preHash[0]?.h === postHash[0]?.h ? '✅ prod 함수 무변경(dry-run write 0)' : '❌ prod 함수 변경됨(HAZARD)');

console.log('\n════════════════════════════════════════════════════════════════');
console.log(anyFlag ? ' 결과: 잔차 material 또는 divergence → planner·DA flag 필요' : ' 결과: 전 기간 AC4 불변식 성립 + 잔차 immaterial ✅');
console.log('════════════════════════════════════════════════════════════════');
