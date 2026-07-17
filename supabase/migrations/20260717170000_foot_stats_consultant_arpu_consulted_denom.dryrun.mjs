/**
 * T-20260717-foot-CONSULTANT-ARPU-STATS (AC6) — DRY-RUN (READ-ONLY)
 *
 * ⚠ SELECT/시뮬레이션만. write/DDL 0. prod foot_stats_consultant 미변경(non-persistence).
 *   NEW 로직(객단가 분모=distinct 상담고객 + consulted_customer_count)을 inline SELECT 로 실행.
 *   검증:
 *     (a) total_amount(분자) 불변 — 구 prod RPC Σ 와 NEW Σ 동일(분모만 바뀌므로 매출 무변).
 *     (b) 객단가 재정의 대조 — 구(÷상담건수) vs 신(÷상담고객) 실장별 병기.
 *     (c) 잔차 계측(BINDING-3: 강제귀속 금지·계측만) — AC4 대사 불변식 재현.
 *     (d) 분모=0 인데 total_amount>0 인 행(의도된 비대칭: 매출귀속만·기간상담 0 → 객단가 NULL) 계측.
 *     (e) consumer flag — avg_amount 를 표시 외 소비하는 코드경로 점검 결과(정적, 아래 CONSUMER_AUDIT).
 *   non-persistence: pre/post prosrc md5 동일 확인(무영속).
 *
 * 실행: node supabase/migrations/20260717170000_foot_stats_consultant_arpu_consulted_denom.dryrun.mjs
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

// NEW 로직 = 마이그 본문과 동일 CTE. 함수 미생성, inline SELECT(무영속). 7컬럼 반환.
const NEW_SQL = (from, to) => `
  WITH
  ticketed AS (
    SELECT DISTINCT ci.id AS check_in_id, ci.consultant_id, ci.customer_id
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
  consulted_cust AS (
    SELECT t.consultant_id, COUNT(DISTINCT t.customer_id)::int AS consulted_customer_count
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
    ROUND((COALESCE(pr.rev,0)+COALESCE(sr.rev,0))::numeric
      / NULLIF(COALESCE(cc.consulted_customer_count,0),0))::bigint AS avg_amount,
    (COALESCE(pr.rev,0)+COALESCE(sr.rev,0))::bigint AS total_amount,
    COALESCE(cc.consulted_customer_count,0) AS consulted_customer_count,
    -- 대조용: 구 정의(÷상담건수) 객단가
    CASE WHEN COALESCE(tk.ticketing_count,0)>0
      THEN ROUND((COALESCE(pr.rev,0)+COALESCE(sr.rev,0))::numeric / tk.ticketing_count)::bigint END AS avg_amount_old
  FROM staff s
  JOIN consultant_universe cu ON cu.consultant_id = s.id
  LEFT JOIN tk_count tk ON tk.consultant_id = s.id
  LEFT JOIN pkg_rev pr ON pr.consultant_id = s.id
  LEFT JOIN pkg_conv pc ON pc.consultant_id = s.id
  LEFT JOIN single_rev sr ON sr.consultant_id = s.id
  LEFT JOIN consulted_cust cc ON cc.consultant_id = s.id
  WHERE s.clinic_id = '${CLINIC}' AND s.role = 'consultant'
  GROUP BY s.id, s.name, tk.ticketing_count, pc.package_count, pr.rev, sr.rev, cc.consulted_customer_count
  ORDER BY ticketing_count DESC, avg_amount DESC NULLS LAST;
`;

const VIEWA_SQL = (from, to) => `
  SELECT COALESCE(SUM(package_amount + single_amount - refund_amount),0)::bigint AS net_a
  FROM foot_stats_revenue('${CLINIC}', '${from}', '${to}');
`;

// 미귀속 잔차(BINDING-3: 강제귀속 금지, 계측만). = View A net − Σ(귀속 net).
const RESIDUAL_DETAIL_SQL = (from, to) => `
  WITH
  ticketed_all AS (
    SELECT DISTINCT ci.customer_id, ci.id AS check_in_id
    FROM check_ins ci JOIN status_transitions st ON st.check_in_id = ci.id
    WHERE ci.clinic_id = '${CLINIC}' AND ci.consultant_id IS NOT NULL AND st.to_status='consultation'
  ),
  pkg_unattr AS (
    SELECT pp.package_id, pp.amount, pp.payment_type
    FROM package_payments pp JOIN packages p ON p.id = pp.package_id
    WHERE pp.clinic_id='${CLINIC}' AND pp.accounting_date BETWEEN '${from}' AND '${to}'
      AND NOT EXISTS (SELECT 1 FROM ticketed_all ta WHERE ta.customer_id = p.customer_id)
  ),
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
];

console.log('════════════════════════════════════════════════════════════════');
console.log(' DRY-RUN: foot_stats_consultant 객단가 분모 pin (AC6) — 상담고객당 ARPU');
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
  const lhs = sumNew + residNet;
  const diff = lhs - netA;
  const residPct = netA !== 0 ? (residNet / netA * 100) : 0;
  const materialFlag = Math.abs(residNet) > 100000 || Math.abs(residPct) > 1;

  // (a) 분자 불변: NEW Σ == 구 prod RPC Σ (객단가 분모만 변경, 매출 무변).
  const numeratorInvariant = sumNew === sumOld;
  // (d) 의도된 비대칭: 분모=0 & total>0 (매출귀속만·기간상담 0 → 객단가 NULL)
  const asymRows = rowsNew.filter((r) => Number(r.consulted_customer_count) === 0 && Number(r.total_amount) !== 0);

  console.log(`\n──── ${label}  [${from} ~ ${to}] ────`);
  console.log(`  분자 불변 확인: NEW Σ(total) ${won(sumNew)} == 구 prod Σ ${won(sumOld)}  ${numeratorInvariant ? '✅ 동일(매출 무변)' : '❌ 분자 drift!'}`);
  console.log(`  View A net ${won(netA)} · 미귀속 잔차 ${won(residNet)}/${residCnt}건 (${residPct.toFixed(2)}%) ${materialFlag ? '⚠ MATERIAL flag' : 'OK'}`);
  console.log(`  AC4 대사: Σ + 잔차 (${won(lhs)}) − View A (${won(netA)}) = ${won(diff)}  ${diff === 0 ? '✅ 불변식 성립' : '❌ DIVERGENCE'}`);
  console.log(`  객단가 NULL(의도된 비대칭: 매출귀속만·기간상담0) : ${asymRows.length}행 ${asymRows.map((r) => `${r.name}(총${won(r.total_amount)})`).join(', ') || '없음'}`);
  if (rowsNew.length) {
    console.log('  실장별 [티켓/상담고객/전환/총매출 | 객단가 신(÷고객) vs 구(÷건수)]:');
    for (const r of rowsNew) {
      console.log(`    - ${r.name}: 티켓 ${r.ticketing_count} / 상담고객 ${r.consulted_customer_count} / 전환 ${r.package_count} / 총매출 ${won(r.total_amount)} | 객단가 ${won(r.avg_amount)} (구 ${won(r.avg_amount_old)})`);
    }
  }
  if (!numeratorInvariant) anyFlag = true;
  if (materialFlag) anyFlag = true;
  if (diff !== 0) anyFlag = true;
}

// non-persistence post-probe
const postHash = await q(`SELECT md5(pg_get_functiondef(p.oid)) AS h FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='foot_stats_consultant';`);
console.log('\n[post-probe] prod foot_stats_consultant prosrc md5 =', postHash[0]?.h);
console.log('[non-persistence]', preHash[0]?.h === postHash[0]?.h ? '✅ prod 함수 무변경(dry-run write 0)' : '❌ prod 함수 변경됨(HAZARD)');

// (e) CONSUMER AUDIT (정적 코드 점검 결과 — avg_amount 를 표시 외 소비하는 경로)
console.log('\n──── avg_amount consumer 점검 (DA §② 요청) ────');
console.log(`  1) src/lib/consultantSalesExport.ts consultantRevenue(): avg_amount*ticketing_count 역산 fallback`);
console.log(`     → total_amount 항상 반환되는 현 RPC 에선 DEAD-PATH(fallback 미발화). 신 정의로도 역산식 무효화되나 미발화라 무해.`);
console.log(`     → 방어적으로 주석 보강(신 정의에선 avg×건수 ≠ total). flag: LOW.`);
console.log(`  2) 매출통계 탭 '일간매출보고' export: consultantUnitPrice(revenue, ticketing_count) 독립 재계산`);
console.log(`     → avg_amount 미소비(자체 ÷상담건수). 화면 객단가(신=÷상담고객)와 정의 divergence.`);
console.log(`     → AC6 스코프 밖(리포터 확정 양식=÷상담건수). planner REPORT 에 divergence 명시. flag: INFO.`);
console.log(`  3) ConsultantSection.tsx 화면 표시 = 표시 전용(정렬 포함). 소비 없음.`);

console.log('\n════════════════════════════════════════════════════════════════');
console.log(anyFlag ? ' 결과: flag 발생 → planner·DA 확인 필요' : ' 결과: 분자 불변 + AC4 불변식 성립 + 잔차 immaterial ✅');
console.log('════════════════════════════════════════════════════════════════');
