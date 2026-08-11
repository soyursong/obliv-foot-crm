-- T-20260811-foot-INS-CLAIM-AUTODRAFT-BACKFILL — ★DECISION-1 range 실측 probe (READ-ONLY)
-- ============================================================
-- 목적: 소급 백필 착수 전, "미청구 급여 진료분(=claim draft 미존재)" 을 진료월(visit month)로
--   분해해 supervisor 실측 365건/3,246,569원 이 7월/8월에 어떻게 걸쳐 있는지 데이터로 확정한다.
--   → ★DECISION-1: from='2026-08-01'(원 요청, 8월만) 이 365건 전량을 커버하는가,
--     아니면 7월분이 별도(a: 지난 8월 청구사이클)인지 본 백필 포함(b: from='2026-07-01')인지.
--
-- 성격: 순수 READ-ONLY(SELECT only). write/DDL 0. GO-token 불요(진단).
-- 실행: POST {mgmt}/v1/projects/rxlomoozakkjesdqjtvd/database/query  body={"query": <본 파일 전체>}
--   또는 pooler psql. clinic = 요양기관기호 13328581 = slug 'jongno-foot' = 74967aea-a60b-4da3-a0e7-9c997a930bc8.
--
-- 판정 규칙:
--   claimable(미청구) = 급여 service_charges(is_insurance_covered=TRUE) 가 있고,
--     해당 check_in 에 claim_status='draft' 청구가 아직 없는 방문. (= fn_build 가 새로 만들 대상)
--   금액 = draft 가 담을 값과 동일 grain 으로 (service_id) 별 latest(calculated_at) dedup 후 verbatim 합산.
--     재산출 아님 — revenue_insurance_split_spec §2-2 SSOT, service_charges 적재값 그대로.
-- ============================================================

WITH clinic AS (
  SELECT id AS clinic_id
  FROM public.clinics
  WHERE slug = 'jongno-foot'          -- 요양기관기호 13328581 정본 링크키(slug), business_no 링크 금지
  ORDER BY id
  LIMIT 1
),
-- 미청구(claim draft 미존재) 급여 방문의 check_in 목록 + 진료일
claimable AS (
  SELECT DISTINCT sc.check_in_id AS cid,
         ci.checked_in_at::date  AS visit_date
  FROM public.service_charges sc
  JOIN public.check_ins ci ON ci.id = sc.check_in_id
  JOIN clinic c            ON c.clinic_id = sc.clinic_id
  WHERE sc.is_insurance_covered = TRUE
    AND sc.check_in_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.insurance_claims ic
      WHERE ic.check_in_id = sc.check_in_id
        AND ic.claim_status = 'draft'
    )
),
-- 방문별 급여금액(draft 와 동일 dedup grain: service_id 별 latest calculated_at, verbatim 합산)
claimable_amt AS (
  SELECT cl.cid,
         cl.visit_date,
         SUM(d.base_amount)              AS total_base,
         SUM(d.copayment_amount)         AS total_copayment,
         SUM(COALESCE(d.insurance_covered_amount, 0)) AS total_covered
  FROM claimable cl
  JOIN LATERAL (
    SELECT DISTINCT ON (sc.service_id)
           sc.base_amount, sc.copayment_amount, sc.insurance_covered_amount
    FROM public.service_charges sc
    WHERE sc.check_in_id = cl.cid
      AND sc.is_insurance_covered = TRUE
    ORDER BY sc.service_id, sc.calculated_at DESC NULLS LAST
  ) d ON TRUE
  GROUP BY cl.cid, cl.visit_date
)
-- ── 진료월 분해 (DECISION-1 핵심) ──
SELECT
  to_char(date_trunc('month', visit_date), 'YYYY-MM')  AS visit_month,
  count(*)                                              AS claimable_checkins,
  SUM(total_base)                                       AS sum_base,
  SUM(total_copayment)                                  AS sum_copayment,
  SUM(total_covered)                                    AS sum_covered,
  min(visit_date)                                       AS first_visit,
  max(visit_date)                                       AS last_visit
FROM claimable_amt
GROUP BY 1
UNION ALL
SELECT
  'TOTAL(all months)'          AS visit_month,
  count(*)                     AS claimable_checkins,
  SUM(total_base)              AS sum_base,
  SUM(total_copayment)         AS sum_copayment,
  SUM(total_covered)           AS sum_covered,
  min(visit_date)              AS first_visit,
  max(visit_date)              AS last_visit
FROM claimable_amt
UNION ALL
-- from='2026-08-01' (원 요청) 커버 부분집합 — 이 값이 365 미만이면 7월분이 잔여(DECISION-1 (a) vs (b))
SELECT
  'REQ-RANGE from=2026-08-01'  AS visit_month,
  count(*)                     AS claimable_checkins,
  SUM(total_base)              AS sum_base,
  SUM(total_copayment)         AS sum_copayment,
  SUM(total_covered)           AS sum_covered,
  min(visit_date)              AS first_visit,
  max(visit_date)              AS last_visit
FROM claimable_amt
WHERE visit_date >= DATE '2026-08-01'
ORDER BY visit_month;

-- 해석 가이드:
--   • TOTAL claimable_checkins ≈ 365 & sum_covered ≈ 3,246,569 → supervisor 실측과 정합 확인.
--   • 'REQ-RANGE from=2026-08-01' 행이 TOTAL 과 같으면 → 7월 잔여 0 → default from='2026-08-01' 로 전량 커버(DECISION-1 종결).
--   • '2026-07' 행이 존재(≥1)하면 → 원 요청 range 로는 7월 N건 미커버 →
--       ★supervisor/reporter 확정 필요: (a) 7월분=지난 8월 청구사이클 별건 → from='2026-08-01' 유지
--                                         (b) 본 백필 포함             → from='2026-07-01' 로 확장.
