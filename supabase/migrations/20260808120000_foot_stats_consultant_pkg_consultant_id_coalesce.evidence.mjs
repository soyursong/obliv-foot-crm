/**
 * T-20260718-foot-PKG-CONSULTANT-ID-RPC-CUTOVER (Phase 2) — AC-3/AC-4 EVIDENCE (READ-ONLY)
 *
 * 목적: 패키지 귀속을 heuristic-only(INNER JOIN) → COALESCE(packages.consultant_id[fact], heuristic)
 *   (LEFT JOIN) 로 바꿨을 때, DA 결정문 Q3/Q4 scope 내 정확히 예상된 변화만 나는지 prod 로 재현.
 *
 *   AC-3(i)   fact IS NULL 패키지: AFTER 귀속 === BEFORE 귀속 (회귀 0).
 *   AC-3(ii)  fact IS NOT NULL 且 fact != heuristic: fact override(정상, 격리 카운트).
 *   AC-3(iii) 귀속이 바뀌는 패키지 count == det-fact override/recovery count (예상외 변화 0 = abort 게이트).
 *   AC-4      실장별 pkg 매출/전환 델타 = det-fact 정정분만 격리(김민경 − / 김주연 +), 그 외 0.
 *
 * ⚠ SELECT만. write 0. non-persistence. prod(rxlomoozakkjesdqjtvd) 대상.
 * 실행: node supabase/migrations/20260808120000_foot_stats_consultant_pkg_consultant_id_coalesce.evidence.mjs
 * author: dev-foot / 2026-08-08
 */
import { readFileSync } from 'node:fs';
const ENV = '/Users/domas/GitHub/obliv-foot-crm/.env.local';
const env = Object.fromEntries(readFileSync(ENV, 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const TOK = env.SUPABASE_ACCESS_TOKEN;
const REF = 'rxlomoozakkjesdqjtvd';
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const FROM = '2000-01-01', TO = '2999-12-31'; // 전기간(정정 총량 재현)
const won = (n) => n == null ? '-' : Number(n).toLocaleString('ko-KR');

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`); return t ? JSON.parse(t) : [];
}

// 공통 CTE: ticketed_all(전기간 상담) + BEFORE/AFTER pkg_attr
const BASE = `
  ticketed_all AS (
    SELECT DISTINCT ci.id AS check_in_id, ci.consultant_id, ci.customer_id, ci.checked_in_at
    FROM check_ins ci JOIN status_transitions st ON st.check_in_id = ci.id
    WHERE ci.clinic_id='${CLINIC}' AND ci.consultant_id IS NOT NULL AND st.to_status='consultation'
  ),
  pkg_attr_before AS (   -- 0724 live: heuristic-only, INNER JOIN
    SELECT DISTINCT ON (p.id) p.id AS package_id, ta.consultant_id AS consultant_id, p.consultant_id AS fact_id
    FROM packages p JOIN ticketed_all ta ON ta.customer_id=p.customer_id
    WHERE p.clinic_id='${CLINIC}'
    ORDER BY p.id, (ta.checked_in_at<=p.created_at) DESC,
             ABS(EXTRACT(EPOCH FROM (p.created_at-ta.checked_in_at))) ASC, ta.check_in_id
  ),
  pkg_attr_after AS (    -- 신: COALESCE(fact, heuristic), LEFT JOIN
    SELECT DISTINCT ON (p.id) p.id AS package_id,
           COALESCE(p.consultant_id, ta.consultant_id) AS consultant_id, p.consultant_id AS fact_id
    FROM packages p LEFT JOIN ticketed_all ta ON ta.customer_id=p.customer_id
    WHERE p.clinic_id='${CLINIC}'
    ORDER BY p.id, (ta.checked_in_at<=p.created_at) DESC,
             ABS(EXTRACT(EPOCH FROM (p.created_at-ta.checked_in_at))) ASC, ta.check_in_id
  )`;

console.log('════ PKG-CONSULTANT-ID COALESCE cutover — AC-3/AC-4 EVIDENCE (read-only) ════');
console.log('prod=%s clinic=%s 기간=%s~%s(전기간)\n', REF, CLINIC.slice(0, 8), FROM, TO);

// [0] 모집단: 전체 패키지 + fact 채워진 수
const pop = (await q(`SELECT COUNT(*) AS total, COUNT(consultant_id) AS fact_filled FROM packages WHERE clinic_id='${CLINIC}'`))[0];
console.log('[0] packages 총 %s개 · consultant_id(fact) 채워진 %s개 (나머지 NULL by-design)', pop.total, pop.fact_filled);

// [1] fact 패키지 전수 열거: fact vs heuristic
const facts = await q(`WITH ${BASE}
  SELECT b.package_id, b.fact_id, sf.name AS fact_name,
         b.consultant_id AS heur_id, sh.name AS heur_name,
         (b.fact_id IS DISTINCT FROM b.consultant_id) AS differs
  FROM pkg_attr_before b
  LEFT JOIN staff sf ON sf.id=b.fact_id
  LEFT JOIN staff sh ON sh.id=b.consultant_id
  WHERE b.fact_id IS NOT NULL
  ORDER BY b.package_id`);
console.log('\n[1] fact(packages.consultant_id NOT NULL) 패키지 전수 (%s건):', facts.length);
for (const f of facts) {
  console.log('    pkg %s… fact=%s(%s) heuristic=%s(%s) → %s',
    String(f.package_id).slice(0, 8), f.fact_name || '?', String(f.fact_id).slice(0, 8),
    f.heur_name || '(상담이력無)', f.heur_id ? String(f.heur_id).slice(0, 8) : '-',
    f.differs ? '★override(정정)' : '동일(무변)');
}

// [2] AC-3(iii) 귀속 변경 패키지 전수 (fact override + recovery). 예상: fact!=heuristic 인 fact 건만.
const changed = await q(`WITH ${BASE}
  SELECT COALESCE(b.package_id,a.package_id) AS package_id,
         b.consultant_id AS before_id, a.consultant_id AS after_id, a.fact_id
  FROM pkg_attr_before b FULL OUTER JOIN pkg_attr_after a ON a.package_id=b.package_id
  WHERE b.consultant_id IS DISTINCT FROM a.consultant_id`);
console.log('\n[2] AC-3(iii) 귀속이 바뀌는 패키지 = %s건 (기대 = fact!=heuristic 인 fact 건수)', changed.length);
for (const c of changed) {
  const kind = c.before_id == null ? 'recovery(상담이력無 fact 회수)'
             : c.fact_id != null ? 'override(fact 우선)' : '⚠UNEXPECTED';
  console.log('    pkg %s… before=%s after=%s [%s]',
    String(c.package_id).slice(0, 8), c.before_id ? String(c.before_id).slice(0, 8) : 'NULL',
    c.after_id ? String(c.after_id).slice(0, 8) : 'NULL', kind);
}

// [3] AC-3(i) fact IS NULL 패키지 회귀 0 검증: before-attr IS DISTINCT FROM after-attr 인 fact-NULL 건 = 0
const nullReg = (await q(`WITH ${BASE}
  SELECT COUNT(*) AS n
  FROM pkg_attr_before b FULL OUTER JOIN pkg_attr_after a ON a.package_id=b.package_id
  WHERE COALESCE(a.fact_id,b.fact_id) IS NULL
    AND b.consultant_id IS DISTINCT FROM a.consultant_id`))[0];
console.log('\n[3] AC-3(i) fact IS NULL 패키지 귀속변경 = %s건 (0 이어야 함 = 회귀 0)', nullReg.n);

// [4] AC-3 예상외 변화 게이트: [2] 中 UNEXPECTED(before=NULL 아님 且 fact=NULL) 건
const unexpected = changed.filter(c => c.before_id != null && c.fact_id == null).length;
console.log('[4] AC-3 예상외 변화(fact 아닌데 귀속 변동) = %s건 (0 이어야 함 = 아니면 abort)', unexpected);

// [5] AC-4 실장별 패키지매출(pkg_rev) BEFORE/AFTER 델타 — 정정분 격리
const revDelta = await q(`WITH ${BASE},
  pr_before AS (
    SELECT pa.consultant_id, SUM(CASE WHEN pp.payment_type='refund' THEN -pp.amount ELSE pp.amount END)::bigint AS rev,
           COUNT(DISTINCT pp.package_id) FILTER (WHERE pp.payment_type='payment')::int AS pkg_cnt
    FROM package_payments pp JOIN pkg_attr_before pa ON pa.package_id=pp.package_id
    WHERE pp.clinic_id='${CLINIC}' AND pp.accounting_date BETWEEN '${FROM}' AND '${TO}'
    GROUP BY pa.consultant_id
  ),
  pr_after AS (
    SELECT pa.consultant_id, SUM(CASE WHEN pp.payment_type='refund' THEN -pp.amount ELSE pp.amount END)::bigint AS rev,
           COUNT(DISTINCT pp.package_id) FILTER (WHERE pp.payment_type='payment')::int AS pkg_cnt
    FROM package_payments pp JOIN pkg_attr_after pa ON pa.package_id=pp.package_id
    WHERE pp.clinic_id='${CLINIC}' AND pp.accounting_date BETWEEN '${FROM}' AND '${TO}'
    GROUP BY pa.consultant_id
  )
  SELECT s.name, COALESCE(a.consultant_id,b.consultant_id) AS cid,
         COALESCE(b.rev,0) AS rev_before, COALESCE(a.rev,0) AS rev_after,
         COALESCE(a.rev,0)-COALESCE(b.rev,0) AS rev_delta,
         COALESCE(b.pkg_cnt,0) AS cnt_before, COALESCE(a.pkg_cnt,0) AS cnt_after
  FROM pr_before b FULL OUTER JOIN pr_after a ON a.consultant_id=b.consultant_id
  LEFT JOIN staff s ON s.id=COALESCE(a.consultant_id,b.consultant_id)
  WHERE COALESCE(a.rev,0) <> COALESCE(b.rev,0) OR COALESCE(a.pkg_cnt,0) <> COALESCE(b.pkg_cnt,0)
  ORDER BY rev_delta`);
console.log('\n[5] AC-4 실장별 패키지매출 델타 (변동 버킷, 전기간):');
if (!revDelta.length) console.log('    (변동 없음)');
// 실장(non-NULL) 출력 델타와 NULL 버킷(phantom)을 분리 집계.
//   최종 함수는 `JOIN staff s ON cu.consultant_id=s.id` 로 NULL 을 탈락시킨다 →
//   BEFORE(INNER JOIN drop) 와 AFTER(LEFT JOIN NULL→staff drop) 모두 출력 부재 = 실 출력 무변.
//   따라서 실 화면 델타 = non-NULL 실장 zero-sum 만 유효, NULL 버킷은 정보성(출력 무영향).
let realDelta = 0, nullDelta = 0;
for (const r of revDelta) {
  const isNull = !r.cid;
  if (isNull) nullDelta += Number(r.rev_delta); else realDelta += Number(r.rev_delta);
  console.log('    %s%s(%s): 매출 %s→%s (Δ%s원) · 전환 %s→%s건',
    isNull ? '⟨phantom·최종 staff join 탈락⟩ ' : '', r.name || '(NULL 미귀속)',
    r.cid ? String(r.cid).slice(0, 8) : '-',
    won(r.rev_before), won(r.rev_after), won(r.rev_delta), r.cnt_before, r.cnt_after);
}
console.log('    실장(non-NULL) Σ델타 = %s원 (0 이어야 함 = zero-sum 이동, 실 화면 총매출 불변)', won(realDelta));
console.log('    NULL 버킷 Σ델타      = %s원 (phantom — 최종 함수 staff INNER JOIN 에서 탈락, 출력 무영향)', won(nullDelta));

// [6] 결정적: 최종 함수 투영(staff INNER JOIN + role='consultant')을 before/after 양쪽으로 재현해
//     total_amount(pkg 성분) 을 diff. NULL phantom 이 실제로 출력에서 탈락함을 실증(leak 0).
const finalDiff = await q(`WITH ${BASE},
  pr_b AS (SELECT pa.consultant_id, SUM(CASE WHEN pp.payment_type='refund' THEN -pp.amount ELSE pp.amount END)::bigint AS rev
           FROM package_payments pp JOIN pkg_attr_before pa ON pa.package_id=pp.package_id
           WHERE pp.clinic_id='${CLINIC}' AND pp.accounting_date BETWEEN '${FROM}' AND '${TO}' GROUP BY pa.consultant_id),
  pr_a AS (SELECT pa.consultant_id, SUM(CASE WHEN pp.payment_type='refund' THEN -pp.amount ELSE pp.amount END)::bigint AS rev
           FROM package_payments pp JOIN pkg_attr_after pa ON pa.package_id=pp.package_id
           WHERE pp.clinic_id='${CLINIC}' AND pp.accounting_date BETWEEN '${FROM}' AND '${TO}' GROUP BY pa.consultant_id),
  out_b AS (SELECT s.id, s.name, COALESCE(b.rev,0) AS pkgrev FROM staff s LEFT JOIN pr_b b ON b.consultant_id=s.id
            WHERE s.clinic_id='${CLINIC}' AND s.role='consultant'),
  out_a AS (SELECT s.id, s.name, COALESCE(a.rev,0) AS pkgrev FROM staff s LEFT JOIN pr_a a ON a.consultant_id=s.id
            WHERE s.clinic_id='${CLINIC}' AND s.role='consultant')
  SELECT ob.name, ob.pkgrev AS before_pkgrev, oa.pkgrev AS after_pkgrev, oa.pkgrev-ob.pkgrev AS delta
  FROM out_b ob JOIN out_a oa ON oa.id=ob.id
  WHERE ob.pkgrev <> oa.pkgrev ORDER BY delta`);
console.log('\n[6] 결정적 최종투영 diff (staff INNER JOIN role=consultant 적용, pkg 성분):');
let outSum = 0;
for (const r of finalDiff) { outSum += Number(r.delta);
  console.log('    %s: %s→%s (Δ%s)', r.name, won(r.before_pkgrev), won(r.after_pkgrev), won(r.delta)); }
console.log('    최종투영 실장 Σ델타 = %s원 (0=zero-sum) · NULL 은 role 필터로 애초 부재(leak 0 실증)', won(outSum));

console.log('\n════ 판정 ════');
console.log('AC-3(i)  회귀 0        : fact-NULL 귀속변경 %s건 (0 기대)', nullReg.n);
console.log('AC-3(iii)정정 격리     : 귀속변경 %s건 == fact-override %s건 (예상외 %s건)', changed.length, facts.filter(f => f.differs).length, unexpected);
console.log('AC-4     zero-sum      : 실장 Σ매출델타 %s원 (0 기대) · NULL phantom %s원(탈락)', won(realDelta), won(nullDelta));
const pass = Number(nullReg.n) === 0 && unexpected === 0 && realDelta === 0
  && changed.length === facts.filter(f => f.differs).length;
console.log(pass ? '\n✅ EVIDENCE PASS — DA Q3/Q4 scope 내 예상 변화만(fact override, 실장 zero-sum). NULL phantom 은 최종 출력 탈락.'
                 : '\n❌ EVIDENCE FAIL — 예상외 변화 감지 → abort, 원인규명 후 재시도.');
console.log('════ END (write 0) ════');
process.exit(pass ? 0 : 1);
