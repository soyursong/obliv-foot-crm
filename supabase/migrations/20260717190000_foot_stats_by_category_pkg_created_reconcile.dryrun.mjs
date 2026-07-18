/**
 * T-20260619-foot-CATSTAT-PKGITEM-SOURCE (reconcile / FIX batch2 재이식) — DRY-RUN (READ-ONLY, 무영속)
 *
 * ⚠ SELECT/시뮬레이션만. write/DDL 0. prod foot_stats_by_category 미변경(non-persistence).
 *   NEW 로직(pkg_created = 패키지 생성 품목 기준 + single_paid accounting_date 보존)을 inline SELECT 로 실행.
 *   base = 현행 prod live(20260715140000: single_paid accounting_date, pkg_used iv-exclude 없음).
 *   검증:
 *     (a) 시그니처 불변 — NEW inline 반환 = (category text, sessions bigint, amount bigint).
 *     (b) 소스 전환 대조 — 구 prod RPC(pkg_used 소진기준) vs NEW(pkg_created 생성기준) 카테고리별 병기.
 *         (booking≠performance = 의도된 차이 = G2 known-limit.)
 *     (c) iv-exclude 정합(point-2) — NEW 결과에 category='iv' 행 부재(패키지 브랜치 배제 확인).
 *     (d) non-persistence — pre/post prosrc md5 동일 확인(dry-run write 0).
 *
 * 실행: node supabase/migrations/20260717190000_foot_stats_by_category_pkg_created_reconcile.dryrun.mjs
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
  return t ? JSON.parse(t) : [];
}

// NEW 로직 = 마이그 본문과 동일(pkg_created + single_paid accounting_date). 함수 미생성, inline SELECT(무영속).
const NEW_SQL = (from, to) => `
  WITH pkg_created AS (
    SELECT
      item.category                                AS category,
      SUM(item.sessions)::bigint                   AS cnt,
      SUM(item.sessions * item.unit_price)::bigint AS amt
    FROM packages p
    CROSS JOIN LATERAL (VALUES
      ('heated_laser',    COALESCE(p.heated_sessions, 0),          COALESCE(p.heated_unit_price, 0)),
      ('unheated_laser',  COALESCE(p.unheated_sessions, 0),        COALESCE(p.unheated_unit_price, 0)),
      ('podologue',       COALESCE(p.podologe_sessions, 0),        COALESCE(p.podologe_unit_price, 0)),
      ('iv',              COALESCE(p.iv_sessions, 0),              COALESCE(p.iv_unit_price, 0)),
      ('trial',           COALESCE(p.trial_sessions, 0),           COALESCE(p.trial_unit_price, 0)),
      ('reborn',          COALESCE(p.reborn_sessions, 0),          COALESCE(p.reborn_unit_price, 0)),
      ('preconditioning', COALESCE(p.preconditioning_sessions, 0), 0)
    ) AS item(category, sessions, unit_price)
    WHERE p.clinic_id = '${CLINIC}'
      AND p.status NOT IN ('cancelled', 'refunded')
      AND p.contract_date BETWEEN '${from}' AND '${to}'
      AND item.sessions > 0
      AND item.category <> 'iv'
    GROUP BY item.category
  ),
  single_paid AS (
    SELECT
      COALESCE(svc.category, 'other') AS category,
      COUNT(DISTINCT cis.id)::bigint  AS cnt,
      SUM(CASE WHEN pay.payment_type = 'refund' THEN -pay.amount ELSE pay.amount END)::bigint AS amt
    FROM payments pay
    JOIN check_in_services cis ON cis.check_in_id = pay.check_in_id
    LEFT JOIN services svc      ON svc.id = cis.service_id
    WHERE pay.clinic_id = '${CLINIC}'
      AND pay.accounting_date BETWEEN '${from}' AND '${to}'
    GROUP BY 1
  ),
  unioned AS (
    SELECT category, cnt, amt FROM pkg_created
    UNION ALL
    SELECT category, cnt, amt FROM single_paid
  )
  SELECT category, SUM(cnt)::bigint AS sessions, SUM(amt)::bigint AS amount
  FROM unioned GROUP BY 1 HAVING SUM(amt) <> 0 OR SUM(cnt) > 0
  ORDER BY amount DESC NULLS LAST;
`;

const PERIODS = [
  ['2026-05-01', '2026-05-31', '2026-05 (월)'],
  ['2026-06-01', '2026-06-30', '2026-06 (월)'],
  ['2026-07-01', '2026-07-31', '2026-07 (월)'],
];

console.log('════════════════════════════════════════════════════════════════');
console.log(' DRY-RUN: foot_stats_by_category 소스 전환 pkg_used→pkg_created (재이식, base=20260715140000)');
console.log(' clinic:', CLINIC, '(오블리브의원 서울오리진점)');
console.log('════════════════════════════════════════════════════════════════');

// (d) non-persistence pre-probe
const preHash = await q(`SELECT md5(pg_get_functiondef(p.oid)) AS h FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='foot_stats_by_category';`);
console.log('\n[pre-probe] prod foot_stats_by_category prosrc md5 =', preHash[0]?.h, '(기대=623999a0e12998f2080b976d3c938731)');

let anyFlag = false;
for (const [from, to, label] of PERIODS) {
  const rowsNew = await q(NEW_SQL(from, to));
  const rowsOld = await q(`SELECT * FROM foot_stats_by_category('${CLINIC}','${from}','${to}') ORDER BY amount DESC NULLS LAST;`);

  const sumNew = rowsNew.reduce((a, r) => a + Number(r.amount), 0);
  const sumOld = rowsOld.reduce((a, r) => a + Number(r.amount), 0);
  const ivLeak = rowsNew.some((r) => r.category === 'iv');

  console.log(`\n──── ${label}  [${from} ~ ${to}] ────`);
  console.log(`  Σ매출 신(생성/booking) ${won(sumNew)}  vs  구(소진/performance) ${won(sumOld)}  (차이=의도된 booking≠performance, G2 known-limit)`);
  console.log(`  iv-exclude 정합: NEW 결과 category='iv' 행 ${ivLeak ? '❌ 누출!' : '✅ 없음(패키지 브랜치 배제 확인)'}`);
  console.log('  카테고리별 [신 생성기준]  :', rowsNew.length ? '' : '(없음)');
  for (const r of rowsNew) console.log(`    - ${r.category}: 회차 ${r.sessions} / 매출 ${won(r.amount)}`);
  console.log('  카테고리별 [구 소진기준]  :', rowsOld.length ? '' : '(없음)');
  for (const r of rowsOld) console.log(`    - ${r.category}: 회차 ${r.sessions} / 매출 ${won(r.amount)}`);
  if (ivLeak) anyFlag = true;
}

// (d) non-persistence post-probe
const postHash = await q(`SELECT md5(pg_get_functiondef(p.oid)) AS h FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='foot_stats_by_category';`);
console.log('\n[post-probe] prod foot_stats_by_category prosrc md5 =', postHash[0]?.h);
const noPersist = preHash[0]?.h === postHash[0]?.h;
console.log('[non-persistence]', noPersist ? '✅ prod 함수 무변경(dry-run write 0)' : '❌ prod 함수 변경됨(HAZARD)');
if (!noPersist) anyFlag = true;

console.log('\n════════════════════════════════════════════════════════════════');
console.log(anyFlag ? ' 결과: flag 발생 → planner·supervisor 확인 필요' : ' 결과: 시그니처 불변 + iv-exclude 정합 + 무영속 ✅');
console.log('════════════════════════════════════════════════════════════════');
