/**
 * T-20260717-foot-PKG-CONSULTANT-ID-ATTR-CAPTURE — 백필 DRY-RUN (READ-ONLY)
 *
 * ⚠ SELECT/시뮬레이션만. write/UPDATE 0. packages.consultant_id 미변경(non-persistence).
 *   heuristic(pkg_attr) 스냅샷을 inline SELECT 로 재현 → 백필이 무엇을 채울지 사전 증거화.
 *
 * 실행 전제: DDL(20260718240000_...capture.sql) 적용 완료(컬럼·트리거 live, 기존행 전량 NULL).
 * 실행: node supabase/migrations/20260718241000_foot_pkg_consultant_id_backfill.dryrun.mjs
 *
 * 산출(AC-C delta 리포트 3자 대비):
 *   ① heuristic(pkg_attr) 귀속 — 백필이 채울 값 (fill 건수 / 상담사별 분포)
 *   ② divergence — heuristic(created_at 최근접) vs 대안(latest 상담) 귀속 갈림 건수·매출영향
 *   ③ NULL 잔차셋 — 귀속불가(ticketed 상담이력 전무) 패키지 목록·매출합 (강제귀속 금지, 계측만)
 *   + non-persistence pre/post-probe(consultant_id NOT NULL 카운트·서명 불변 확인)
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

// ① heuristic(pkg_attr) — 백필이 채울 값. (마이그 본문과 동일 로직, inline SELECT = 무영속)
const HEUR_SQL = `
  WITH ticketed_all AS (
    SELECT DISTINCT ci.id AS check_in_id, ci.consultant_id, ci.customer_id, ci.checked_in_at
    FROM check_ins ci JOIN status_transitions st ON st.check_in_id = ci.id
    WHERE ci.clinic_id='${CLINIC}' AND ci.consultant_id IS NOT NULL AND st.to_status='consultation'
  ),
  pkg_attr AS (
    SELECT DISTINCT ON (p.id) p.id AS package_id, ta.consultant_id
    FROM packages p JOIN ticketed_all ta ON ta.customer_id = p.customer_id
    WHERE p.clinic_id='${CLINIC}'
    ORDER BY p.id, (ta.checked_in_at <= p.created_at) DESC,
      ABS(EXTRACT(EPOCH FROM (p.created_at - ta.checked_in_at))) ASC, ta.check_in_id
  )
  SELECT
    (SELECT COUNT(*) FROM packages WHERE clinic_id='${CLINIC}')                               AS total_pkg,
    (SELECT COUNT(*) FROM pkg_attr WHERE consultant_id IS NOT NULL)                           AS would_fill,
    (SELECT COUNT(*) FROM packages p WHERE p.clinic_id='${CLINIC}'
       AND NOT EXISTS (SELECT 1 FROM pkg_attr pa WHERE pa.package_id=p.id AND pa.consultant_id IS NOT NULL)) AS null_residual;
`;

// ① 상담사별 fill 분포
const HEUR_DIST_SQL = `
  WITH ticketed_all AS (
    SELECT DISTINCT ci.id AS check_in_id, ci.consultant_id, ci.customer_id, ci.checked_in_at
    FROM check_ins ci JOIN status_transitions st ON st.check_in_id = ci.id
    WHERE ci.clinic_id='${CLINIC}' AND ci.consultant_id IS NOT NULL AND st.to_status='consultation'
  ),
  pkg_attr AS (
    SELECT DISTINCT ON (p.id) p.id AS package_id, ta.consultant_id
    FROM packages p JOIN ticketed_all ta ON ta.customer_id = p.customer_id
    WHERE p.clinic_id='${CLINIC}'
    ORDER BY p.id, (ta.checked_in_at <= p.created_at) DESC,
      ABS(EXTRACT(EPOCH FROM (p.created_at - ta.checked_in_at))) ASC, ta.check_in_id
  )
  SELECT s.name, COUNT(*)::int AS pkg_cnt,
         SUM(p.total_amount)::bigint AS contract_amt
  FROM pkg_attr pa JOIN packages p ON p.id=pa.package_id
  JOIN staff s ON s.id=pa.consultant_id
  WHERE pa.consultant_id IS NOT NULL
  GROUP BY s.name ORDER BY pkg_cnt DESC;
`;

// ② divergence: heuristic(created_at 최근접) vs 대안(고객 latest 상담) 귀속 갈림.
const DIVERGE_SQL = `
  WITH ticketed_all AS (
    SELECT DISTINCT ci.id AS check_in_id, ci.consultant_id, ci.customer_id, ci.checked_in_at
    FROM check_ins ci JOIN status_transitions st ON st.check_in_id = ci.id
    WHERE ci.clinic_id='${CLINIC}' AND ci.consultant_id IS NOT NULL AND st.to_status='consultation'
  ),
  pkg_heur AS (
    SELECT DISTINCT ON (p.id) p.id AS package_id, p.total_amount, ta.consultant_id
    FROM packages p JOIN ticketed_all ta ON ta.customer_id = p.customer_id
    WHERE p.clinic_id='${CLINIC}'
    ORDER BY p.id, (ta.checked_in_at <= p.created_at) DESC,
      ABS(EXTRACT(EPOCH FROM (p.created_at - ta.checked_in_at))) ASC, ta.check_in_id
  ),
  pkg_latest AS (
    SELECT DISTINCT ON (p.id) p.id AS package_id, ta.consultant_id
    FROM packages p JOIN ticketed_all ta ON ta.customer_id = p.customer_id
    WHERE p.clinic_id='${CLINIC}'
    ORDER BY p.id, ta.checked_in_at DESC, ta.check_in_id
  )
  SELECT COUNT(*)::int AS divergent_cnt,
         COALESCE(SUM(h.total_amount),0)::bigint AS divergent_contract_amt
  FROM pkg_heur h JOIN pkg_latest l ON l.package_id=h.package_id
  WHERE h.consultant_id IS DISTINCT FROM l.consultant_id;
`;

// ③ NULL 잔차셋 — 귀속불가 패키지 목록·매출합(계약총액). 강제귀속 금지 계측.
const RESIDUAL_SQL = `
  WITH ticketed_all AS (
    SELECT DISTINCT ci.customer_id
    FROM check_ins ci JOIN status_transitions st ON st.check_in_id = ci.id
    WHERE ci.clinic_id='${CLINIC}' AND ci.consultant_id IS NOT NULL AND st.to_status='consultation'
  )
  SELECT p.id, p.package_name, p.total_amount, p.status, (p.created_at AT TIME ZONE 'Asia/Seoul')::date AS created
  FROM packages p
  WHERE p.clinic_id='${CLINIC}'
    AND NOT EXISTS (SELECT 1 FROM ticketed_all ta WHERE ta.customer_id=p.customer_id)
  ORDER BY p.total_amount DESC;
`;

// non-persistence probe: consultant_id 상태 서명(카운트 + 집계 서명).
const PROBE_SQL = `
  SELECT COUNT(*) FILTER (WHERE consultant_id IS NOT NULL)::int AS non_null_cnt,
         COALESCE(md5(string_agg(id::text || ':' || COALESCE(consultant_id::text,'∅'), ',' ORDER BY id)),'∅') AS sig
  FROM packages WHERE clinic_id='${CLINIC}';
`;

console.log('════════════════════════════════════════════════════════════════');
console.log(' DRY-RUN: packages.consultant_id 백필 (heuristic pkg_attr 스냅샷)');
console.log(' clinic:', CLINIC, '(오블리브의원 서울오리진점)');
console.log('════════════════════════════════════════════════════════════════');

// pre-probe (컬럼 존재 확인 겸)
let pre;
try {
  pre = (await q(PROBE_SQL))[0];
} catch (e) {
  console.log('\n❌ probe 실패 — packages.consultant_id 컬럼 미존재? DDL(capture.sql) 선적용 필요.');
  console.log('   ', String(e).slice(0, 200));
  process.exit(1);
}
console.log(`\n[pre-probe] consultant_id NOT NULL = ${pre.non_null_cnt}건 · sig=${pre.sig.slice(0, 12)}…`);

// ① heuristic 요약
const h = (await q(HEUR_SQL))[0];
console.log('\n──── ① heuristic(pkg_attr) 귀속 — 백필이 채울 값 ────');
console.log(`  전체 foot 패키지          : ${h.total_pkg}건`);
console.log(`  fill(귀속값 존재)         : ${h.would_fill}건`);
console.log(`  NULL 잔차(귀속불가)       : ${h.null_residual}건  (강제귀속 금지 → NULL 유지)`);
const dist = await q(HEUR_DIST_SQL);
console.log('  상담사별 fill 분포:');
for (const r of dist) console.log(`    - ${r.name}: ${r.pkg_cnt}건 / 계약총액 ${won(r.contract_amt)}`);

// ② divergence
const d = (await q(DIVERGE_SQL))[0];
console.log('\n──── ② divergence: heuristic(최근접) vs 대안(latest 상담) ────');
console.log(`  귀속 갈림 패키지          : ${d.divergent_cnt}건 / 계약총액영향 ${won(d.divergent_contract_amt)}`);
console.log(`  → heuristic 은 부모 배포본 stats 진실과 동일 소스. 대안 대비 갈림은 감사참고(백필=heuristic 채택).`);

// ③ NULL 잔차셋
const resid = await q(RESIDUAL_SQL);
const residSum = resid.reduce((a, r) => a + Number(r.total_amount || 0), 0);
console.log('\n──── ③ NULL 잔차셋 (귀속불가 패키지 = 상담이력 전무) ────');
console.log(`  건수: ${resid.length}건 · 계약총액합: ${won(residSum)}  (강제귀속 금지 · NULL 유지 · 계측)`);
for (const r of resid.slice(0, 20)) console.log(`    - ${r.id.slice(0, 8)} | ${r.created} | ${r.package_name ?? '-'} | ${won(r.total_amount)} | ${r.status}`);
if (resid.length > 20) console.log(`    … 외 ${resid.length - 20}건`);

// 정합 체크: would_fill + null_residual == total
const consistent = Number(h.would_fill) + Number(h.null_residual) === Number(h.total_pkg);
console.log(`\n  정합: fill(${h.would_fill}) + 잔차(${h.null_residual}) == 전체(${h.total_pkg}) → ${consistent ? '✅' : '❌ 불일치'}`);

// post-probe (non-persistence)
const post = (await q(PROBE_SQL))[0];
console.log(`\n[post-probe] consultant_id NOT NULL = ${post.non_null_cnt}건 · sig=${post.sig.slice(0, 12)}…`);
const noWrite = pre.non_null_cnt === post.non_null_cnt && pre.sig === post.sig;
console.log('[non-persistence]', noWrite ? '✅ packages.consultant_id 무변경(dry-run write 0)' : '❌ 변경됨(HAZARD)');

console.log('\n════════════════════════════════════════════════════════════════');
console.log(consistent && noWrite
  ? ' 결과: 백필 준비 OK — heuristic 스냅샷 정합 + 무영속 확인 ✅'
  : ' 결과: ⚠ 정합/무영속 이상 → planner·DA flag 필요');
console.log('════════════════════════════════════════════════════════════════');
