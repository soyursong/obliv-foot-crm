/**
 * T-20260726-foot-ASSIGN-STAFFCUMUL-REVISIT-MISCOUNT — PROD 읽기전용 진단
 *
 * 현장 리포트: 상담·치료사 배정 > 직원별 누적 > 당월 누적. 배정(재진) 반영 수가 전부 초진으로 집계.
 * 목적: A(집계 산식/판정소스) vs B(데이터 오염) 확정.
 *   화면 재진 판정 = recency(최근 done 방문 365일 이내, 당일·타지점·soft-hide 제외).
 *   현장 기대 재진 = customers.visit_type='returning' (DB 당월 returning 건수).
 * 두 소스를 당월 상담 배정 check_ins 위에서 대조 → 괴리 지점 규명.
 * READ-ONLY (SELECT only). author: dev-foot / 2026-07-26
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1].trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no token'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql })
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const out = {};

// 당월 경계(KST): 화면과 동일 — 이달 1일 00:00 ~ 오늘+1일 00:00(exclusive).
const MONTH = `ci.checked_in_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul'))::timestamp AT TIME ZONE 'Asia/Seoul'
           AND ci.checked_in_at <  ((date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') + interval '1 day'))::timestamp AT TIME ZONE 'Asia/Seoul'`;

// recency 재진 판정을 SQL 로 재현: 같은 customer + 같은 clinic + status=done + deleted_at null
//   + checked_in_at < 오늘(KST) 자정(당일 자기방문 제외). 최근 done 날짜와 오늘 diff<=365 → returning.
const RECENCY_RETURNING = `EXISTS (
  SELECT 1 FROM check_ins d
  WHERE d.customer_id = ci.customer_id
    AND d.clinic_id = ci.clinic_id
    AND d.status = 'done'
    AND d.deleted_at IS NULL
    AND d.checked_in_at < (date_trunc('day', now() AT TIME ZONE 'Asia/Seoul'))::timestamp AT TIME ZONE 'Asia/Seoul'
    AND ( (date_trunc('day', now() AT TIME ZONE 'Asia/Seoul'))::date
          - (d.checked_in_at AT TIME ZONE 'Asia/Seoul')::date ) <= 365
)`;

// 0) 오늘/월경계 확인
out.c0_now = await q(`SELECT (now() AT TIME ZONE 'Asia/Seoul') now_kst,
  (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul'))::date month_start,
  (date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') + interval '1 day')::date month_end_excl;`);

// 1) 당월 상담 배정(consultant_id 有) check_ins 총건 + 두 소스별 재진/초진 분포
out.c1_consult_axis_compare = await q(
  `SELECT
     count(*) AS total_consult_assign,
     count(*) FILTER (WHERE c.visit_type = 'returning') AS stored_returning,
     count(*) FILTER (WHERE c.visit_type IS DISTINCT FROM 'returning') AS stored_new,
     count(*) FILTER (WHERE ${RECENCY_RETURNING}) AS recency_returning,
     count(*) FILTER (WHERE NOT (${RECENCY_RETURNING})) AS recency_new
   FROM check_ins ci
   LEFT JOIN customers c ON c.id = ci.customer_id
   WHERE ci.clinic_id = (SELECT id FROM clinics WHERE slug LIKE '%foot%' OR name LIKE '%풋%' ORDER BY created_at LIMIT 1)
     AND ci.deleted_at IS NULL
     AND ci.consultant_id IS NOT NULL
     AND ${MONTH};`);

// 1b) clinic 무관 총량(스코프 착오 대비) — 전 clinic 합산
out.c1b_allclinic = await q(
  `SELECT
     count(*) AS total_consult_assign,
     count(*) FILTER (WHERE c.visit_type = 'returning') AS stored_returning,
     count(*) FILTER (WHERE ${RECENCY_RETURNING}) AS recency_returning
   FROM check_ins ci
   LEFT JOIN customers c ON c.id = ci.customer_id
   WHERE ci.deleted_at IS NULL AND ci.consultant_id IS NOT NULL AND ${MONTH};`);

// 2) 교차표: stored vs recency (괴리 셀 규명)
out.c2_crosstab = await q(
  `SELECT
     (c.visit_type = 'returning') AS stored_ret,
     ${RECENCY_RETURNING} AS recency_ret,
     count(*) n
   FROM check_ins ci
   LEFT JOIN customers c ON c.id = ci.customer_id
   WHERE ci.deleted_at IS NULL AND ci.consultant_id IS NOT NULL AND ${MONTH}
   GROUP BY 1,2 ORDER BY 1,2;`);

// 3) 실장별 당월 배정 — stored vs recency 재진 카운트 (현장 "특정 실장" 대조용)
out.c3_by_consultant = await q(
  `SELECT s.name AS consultant,
     count(*) AS total_assign,
     count(*) FILTER (WHERE c.visit_type='returning') AS stored_ret,
     count(*) FILTER (WHERE ${RECENCY_RETURNING}) AS recency_ret
   FROM check_ins ci
   LEFT JOIN customers c ON c.id = ci.customer_id
   LEFT JOIN staff s ON s.id = ci.consultant_id
   WHERE ci.deleted_at IS NULL AND ci.consultant_id IS NOT NULL AND ${MONTH}
   GROUP BY s.name ORDER BY total_assign DESC;`);

// 4) check_ins.visit_type(접수 스냅샷) 자체 분포 — 배정건 기준
out.c4_ci_visittype = await q(
  `SELECT ci.visit_type, count(*) n
   FROM check_ins ci
   WHERE ci.deleted_at IS NULL AND ci.consultant_id IS NOT NULL AND ${MONTH}
   GROUP BY ci.visit_type ORDER BY n DESC;`);

// 5) clinic 존재 확인
out.c5_clinics = await q(`SELECT id, slug, name FROM clinics ORDER BY created_at;`);

console.log(JSON.stringify(out, null, 2));
