/**
 * T-20260724-foot-CONSULTANT-SINGLEPAY-STAFFATTR-SWAP-RCA — 진단(READ-ONLY)
 *
 * 목적: 통계 '상담실장 티켓팅 실적'(foot_stats_consultant, consultant_id 축)과
 *   일마감 '결제담당 필터'(customers.assigned_staff_id 축)에서 강경민↔정연주 수치 역전이
 *   (H1) single_cust 폴백의 customer→consultant 매핑 방향 역전(회귀)인지,
 *   (H2) 두 화면의 축 차이(상담 consultant_id vs 배정 assigned_staff_id)인지 데이터로 판정.
 *
 * ⚠ SELECT만. write 0. prod(rxlomoozakkjesdqjtvd).
 *
 * ─── 판정 결과 (2026-07-24) ─────────────────────────────────────────────────────
 *   ▶ H2 확정 (축 오인) — 강경민↔정연주 귀속 스왑/회귀 아님. single_rev 매핑 방향 정상.
 *   현장 캡처 = 2026-07-23 단일일자. 통계(상담실장 consultant_id 축) 강경민 300,500 / 정연주 547,600,
 *   일마감(결제담당 = customers.assigned_staff_id 축) 강경민 549,300 / 정연주 298,800.
 *   두 화면 역전의 100% 진원 = 고객 '정은우'(248,800원) 1명:
 *     · 차트 배정담당(assigned_staff) = 강경민  → 일마감에서 강경민으로 집계
 *     · 실제 상담 상담사(check_in consultant_id) = 정연주 → 통계에서 정연주로 집계 (07-23 15:36 결정적 링크 fact)
 *   그 외 모든 07-23 단건결제는 두 축이 동일인으로 일치. single_cust/single_direct 조인 방향에
 *   강경민↔정연주 역전 0건(per-payment 검증). pkg_rev(동형 원본)도 스왑 0.
 *   ▶ 조치: 코드변경 0. parent(cccfa30161ba) 롤백 불요 — field-soak 정상 진행.
 *     parent 배포는 정은우 240,000 미결선 단건을 실제 상담사(정연주)로 올바르게 회수한 것(의도된 수정).
 * ────────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync } from 'node:fs';
const ENV = '/Users/domas/GitHub/obliv-foot-crm/.env.local';
const env = Object.fromEntries(readFileSync(ENV, 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const TOK = env.SUPABASE_ACCESS_TOKEN;
const REF = 'rxlomoozakkjesdqjtvd';
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const won = (n) => n == null ? '-' : Number(n).toLocaleString('ko-KR');

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql })
  });
  const t = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`); return JSON.parse(t);
}

console.log('════ STAFFATTR-SWAP RCA 진단 (read-only) ════\n');

// 1) staff 마스터 — 강경민 / 정연주
console.log('── 1) staff 마스터 (강경민/정연주) ──');
const staff = await q(`SELECT id, name, role, clinic_id
  FROM staff WHERE clinic_id='${CLINIC}' AND (name LIKE '%강경민%' OR name LIKE '%정연주%') ORDER BY name`);
console.table(staff);
const kang = staff.find(s => (s.name||'').includes('강경민'));
const jung = staff.find(s => (s.name||'').includes('정연주'));
console.log('강경민 id=%s role=%s | 정연주 id=%s role=%s\n',
  kang?.id, kang?.role, jung?.id, jung?.role);

// 2) 통계 화면 재현 — foot_stats_consultant (7월)
for (const [from, to] of [['2026-07-01','2026-07-31'],['2026-07-01','2026-07-24']]) {
  console.log(`── 2) 통계 foot_stats_consultant(${from}~${to}) 강경민/정연주 ──`);
  const rows = await q(`SELECT consultant_id, name, ticketing_count, package_count,
     avg_amount, total_amount, consulted_customer_count
   FROM foot_stats_consultant('${CLINIC}'::uuid, '${from}'::date, '${to}'::date)
   WHERE name LIKE '%강경민%' OR name LIKE '%정연주%' ORDER BY name`);
  console.table(rows.map(r => ({...r, avg_amount: won(r.avg_amount), total_amount: won(r.total_amount)})));
}

// 3) 통계 total_amount 분해: pkg_rev vs single_rev (7월) per 강경민/정연주
const BASE = (from, to) => `
  ticketed_all AS (
    SELECT DISTINCT ci.id AS check_in_id, ci.consultant_id, ci.customer_id, ci.checked_in_at
    FROM check_ins ci JOIN status_transitions st ON st.check_in_id=ci.id
    WHERE ci.clinic_id='${CLINIC}' AND ci.consultant_id IS NOT NULL AND st.to_status='consultation'
  ),
  pkg_attr AS (
    SELECT DISTINCT ON (p.id) p.id AS package_id, ta.consultant_id
    FROM packages p JOIN ticketed_all ta ON ta.customer_id=p.customer_id
    WHERE p.clinic_id='${CLINIC}'
    ORDER BY p.id, (ta.checked_in_at<=p.created_at) DESC,
             ABS(EXTRACT(EPOCH FROM (p.created_at-ta.checked_in_at))) ASC, ta.check_in_id
  ),
  pkg_rev AS (
    SELECT pa.consultant_id, SUM(CASE WHEN pp.payment_type='refund' THEN -pp.amount ELSE pp.amount END)::bigint AS rev
    FROM package_payments pp JOIN pkg_attr pa ON pa.package_id=pp.package_id
    WHERE pp.clinic_id='${CLINIC}' AND pp.accounting_date BETWEEN '${from}' AND '${to}'
    GROUP BY pa.consultant_id
  ),
  payment_base AS (
    SELECT pay.id AS payment_id, pay.check_in_id,
           COALESCE(pay.customer_id, ci.customer_id) AS customer_id, pay.created_at,
           (CASE WHEN pay.payment_type='refund' THEN -pay.amount ELSE pay.amount END)::bigint AS net
    FROM payments pay LEFT JOIN check_ins ci ON ci.id=pay.check_in_id
    WHERE pay.clinic_id='${CLINIC}' AND pay.accounting_date BETWEEN '${from}' AND '${to}'
  ),
  single_direct AS (
    SELECT DISTINCT ON (pb.payment_id) pb.payment_id, ta.consultant_id
    FROM payment_base pb JOIN ticketed_all ta ON ta.check_in_id=pb.check_in_id
    ORDER BY pb.payment_id, ta.check_in_id
  ),
  single_cust AS (
    SELECT DISTINCT ON (pb.payment_id) pb.payment_id, ta.consultant_id
    FROM payment_base pb JOIN ticketed_all ta ON ta.customer_id=pb.customer_id
    WHERE pb.payment_id NOT IN (SELECT payment_id FROM single_direct)
    ORDER BY pb.payment_id, (ta.checked_in_at<=pb.created_at) DESC,
             ABS(EXTRACT(EPOCH FROM (pb.created_at-ta.checked_in_at))) ASC, ta.check_in_id
  ),
  single_attr AS (SELECT payment_id, consultant_id FROM single_direct UNION ALL SELECT payment_id, consultant_id FROM single_cust),
  single_rev AS (SELECT sa.consultant_id, SUM(pb.net)::bigint AS rev
    FROM single_attr sa JOIN payment_base pb ON pb.payment_id=sa.payment_id GROUP BY sa.consultant_id)`;

console.log('── 3) 통계 total 분해 pkg_rev / single_rev (2026-07-01~31) ──');
const decomp = await q(`WITH ${BASE('2026-07-01','2026-07-31')}
  SELECT s.name,
    COALESCE(pr.rev,0) AS pkg_rev, COALESCE(sr.rev,0) AS single_rev,
    (COALESCE(pr.rev,0)+COALESCE(sr.rev,0)) AS total
  FROM staff s
  LEFT JOIN pkg_rev pr ON pr.consultant_id=s.id
  LEFT JOIN single_rev sr ON sr.consultant_id=s.id
  WHERE s.clinic_id='${CLINIC}' AND (s.name LIKE '%강경민%' OR s.name LIKE '%정연주%')
  ORDER BY s.name`);
console.table(decomp.map(r => ({name:r.name, pkg_rev:won(r.pkg_rev), single_rev:won(r.single_rev), total:won(r.total)})));

// 4) 일마감 '결제담당' 축 재현 — customers.assigned_staff_id 기준 (payments + package_payments, 7월)
console.log('── 4) 일마감 결제담당 축 = customers.assigned_staff_id (2026-07-01~31, payments+pkg) ──');
const closing = await q(`
  WITH pay AS (
    SELECT COALESCE(pay.customer_id, ci.customer_id) AS customer_id,
           (CASE WHEN pay.payment_type='refund' THEN -pay.amount ELSE pay.amount END)::bigint AS net
    FROM payments pay LEFT JOIN check_ins ci ON ci.id=pay.check_in_id
    WHERE pay.clinic_id='${CLINIC}' AND pay.accounting_date BETWEEN '2026-07-01' AND '2026-07-31'
    UNION ALL
    SELECT pp.customer_id,
           (CASE WHEN pp.payment_type='refund' THEN -pp.amount ELSE pp.amount END)::bigint AS net
    FROM package_payments pp
    WHERE pp.clinic_id='${CLINIC}' AND pp.accounting_date BETWEEN '2026-07-01' AND '2026-07-31'
  )
  SELECT s.name, COUNT(*) AS cnt, SUM(pay.net)::bigint AS rev
  FROM pay JOIN customers c ON c.id=pay.customer_id
  JOIN staff s ON s.id=c.assigned_staff_id
  WHERE s.name LIKE '%강경민%' OR s.name LIKE '%정연주%'
  GROUP BY s.name ORDER BY s.name`);
console.table(closing.map(r => ({name:r.name, cnt:r.cnt, rev:won(r.rev)})));

// 5) 축 교차: assigned_staff_id 축 고객이 실제 상담(consultant_id) 축에서 누구에게 귀속되는지
console.log('── 5) 축 교차 진단: assigned_staff(강/정) 고객의 실제 상담 consultant 분포 ──');
const cross = await q(`
  WITH ta AS (
    SELECT DISTINCT ci.customer_id, ci.consultant_id, ci.checked_in_at
    FROM check_ins ci JOIN status_transitions st ON st.check_in_id=ci.id
    WHERE ci.clinic_id='${CLINIC}' AND ci.consultant_id IS NOT NULL AND st.to_status='consultation'
  ),
  latest AS (
    SELECT DISTINCT ON (customer_id) customer_id, consultant_id
    FROM ta ORDER BY customer_id, checked_in_at DESC
  )
  SELECT sa.name AS assigned_staff, sc.name AS consultant, COUNT(*) AS customers
  FROM customers c
  JOIN staff sa ON sa.id=c.assigned_staff_id
  LEFT JOIN latest l ON l.customer_id=c.id
  LEFT JOIN staff sc ON sc.id=l.consultant_id
  WHERE c.clinic_id='${CLINIC}' AND (sa.name LIKE '%강경민%' OR sa.name LIKE '%정연주%')
  GROUP BY sa.name, sc.name ORDER BY sa.name, customers DESC`);
console.table(cross);

console.log('\n════ END (write 0) ════');
