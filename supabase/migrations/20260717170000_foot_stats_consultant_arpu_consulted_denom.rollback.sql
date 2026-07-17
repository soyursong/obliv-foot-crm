-- ============================================================
-- ROLLBACK — T-20260717-foot-CONSULTANT-ARPU-STATS (AC6)
-- foot_stats_consultant 을 직전(6-col base = 20260717160000 권고안 A) 본문으로 역전.
--   반환형 7→6컬럼 축소 → DROP FUNCTION IF EXISTS + CREATE (단일 txn, 멱등, 42P13 회피).
--   ★ 역전 시 객단가(avg_amount) 분모는 다시 ticketing_count(상담건수) 로,
--     consulted_customer_count 컬럼은 소실됨. total_amount·귀속 로직은 동일(무손상).
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS public.foot_stats_consultant(UUID, DATE, DATE);

CREATE FUNCTION public.foot_stats_consultant(
  p_clinic_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (
  consultant_id   UUID,
  name            TEXT,
  ticketing_count INT,
  package_count   INT,
  avg_amount      BIGINT,
  total_amount    BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH
  ticketed AS (
    SELECT DISTINCT
      ci.id AS check_in_id,
      ci.consultant_id
    FROM check_ins ci
    JOIN status_transitions st ON st.check_in_id = ci.id
    WHERE ci.clinic_id = p_clinic_id
      AND ci.consultant_id IS NOT NULL
      AND (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN p_from AND p_to
      AND st.to_status = 'consultation'
  ),
  ticketed_all AS (
    SELECT DISTINCT
      ci.id AS check_in_id,
      ci.consultant_id,
      ci.customer_id,
      ci.checked_in_at
    FROM check_ins ci
    JOIN status_transitions st ON st.check_in_id = ci.id
    WHERE ci.clinic_id = p_clinic_id
      AND ci.consultant_id IS NOT NULL
      AND st.to_status = 'consultation'
  ),
  pkg_attr AS (
    SELECT DISTINCT ON (p.id)
      p.id             AS package_id,
      ta.consultant_id AS consultant_id
    FROM packages p
    JOIN ticketed_all ta ON ta.customer_id = p.customer_id
    WHERE p.clinic_id = p_clinic_id
    ORDER BY
      p.id,
      (ta.checked_in_at <= p.created_at) DESC,
      ABS(EXTRACT(EPOCH FROM (p.created_at - ta.checked_in_at))) ASC,
      ta.check_in_id
  ),
  pkg_rev AS (
    SELECT
      pa.consultant_id,
      SUM(CASE WHEN pp.payment_type = 'refund' THEN -pp.amount ELSE pp.amount END)::bigint AS rev
    FROM package_payments pp
    JOIN pkg_attr pa ON pa.package_id = pp.package_id
    WHERE pp.clinic_id = p_clinic_id
      AND pp.accounting_date BETWEEN p_from AND p_to
    GROUP BY pa.consultant_id
  ),
  pkg_conv AS (
    SELECT
      pa.consultant_id,
      COUNT(DISTINCT pp.package_id)::int AS package_count
    FROM package_payments pp
    JOIN pkg_attr pa ON pa.package_id = pp.package_id
    WHERE pp.clinic_id = p_clinic_id
      AND pp.accounting_date BETWEEN p_from AND p_to
      AND pp.payment_type = 'payment'
    GROUP BY pa.consultant_id
  ),
  single_rev AS (
    SELECT
      ta.consultant_id,
      SUM(CASE WHEN pay.payment_type = 'refund' THEN -pay.amount ELSE pay.amount END)::bigint AS rev
    FROM payments pay
    JOIN ticketed_all ta ON ta.check_in_id = pay.check_in_id
    WHERE pay.clinic_id = p_clinic_id
      AND pay.accounting_date BETWEEN p_from AND p_to
    GROUP BY ta.consultant_id
  ),
  tk_count AS (
    SELECT t.consultant_id, COUNT(DISTINCT t.check_in_id)::int AS ticketing_count
    FROM ticketed t
    GROUP BY t.consultant_id
  ),
  consultant_universe AS (
    SELECT consultant_id FROM tk_count
    UNION
    SELECT consultant_id FROM pkg_rev
    UNION
    SELECT consultant_id FROM single_rev
  )
  SELECT
    s.id   AS consultant_id,
    s.name AS name,
    COALESCE(tk.ticketing_count, 0)                                     AS ticketing_count,
    COALESCE(pc.package_count, 0)                                       AS package_count,
    CASE
      WHEN COALESCE(tk.ticketing_count, 0) > 0
      THEN ROUND(
             (COALESCE(pr.rev, 0) + COALESCE(sr.rev, 0))::numeric
             / tk.ticketing_count
           )::bigint
      ELSE 0
    END                                                                 AS avg_amount,
    (COALESCE(pr.rev, 0) + COALESCE(sr.rev, 0))::bigint                  AS total_amount
  FROM staff s
  JOIN consultant_universe cu ON cu.consultant_id = s.id
  LEFT JOIN tk_count   tk ON tk.consultant_id = s.id
  LEFT JOIN pkg_rev    pr ON pr.consultant_id = s.id
  LEFT JOIN pkg_conv   pc ON pc.consultant_id = s.id
  LEFT JOIN single_rev sr ON sr.consultant_id = s.id
  WHERE s.clinic_id = p_clinic_id
    AND s.role = 'consultant'
  GROUP BY s.id, s.name, tk.ticketing_count, pc.package_count, pr.rev, sr.rev
  ORDER BY ticketing_count DESC, avg_amount DESC;
$$;

REVOKE ALL ON FUNCTION public.foot_stats_consultant(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.foot_stats_consultant(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.foot_stats_consultant(UUID, DATE, DATE)
  IS 'foot-stats: 상담실장 실적(총매출/객단가/전환). 권고안 A 시간정렬 재구성 — 패키지매출 귀속=고객의 ticketed 상담 中 packages.created_at 최근접 consultant_id. avg_amount=total ÷ ticketing_count(=상담건수). T-20260717-foot-DAYCLOSE-VS-SIDEBAR-MGRSTAT-RECONCILE (AC6 rollback).';

COMMIT;
